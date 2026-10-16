import "server-only";
import { randomBytes } from "node:crypto";
import { adminDb } from "./supabase";
import { addEvent, STAGES, STAGE_LABEL, type Stage } from "./crm";
import { logItem, recordPurchase, syncWebStatus, type Item } from "./stock";
import { isOwnerStock } from "./stock-labels";
import { DOC_DEFAULTS, DOC_SETTING_KEYS, KIND_LABEL, KIND_PREFIX, docTotals, paidSoFar, returnTerms, termsFor, usd, type Doc, type DocKind, type DocLine, type DocPayment, type DocSettings } from "./doc-labels";
import { escapeHtml as h, notifyAdmins } from "./telegram";

// Cotizaciones, memos y facturas. Van enlazadas al cliente del CRM y a los relojes del inventario:
// un memo o una factura enviada reserva el reloj; una factura pagada lo marca vendido.

export async function getDocSettings(): Promise<Required<DocSettings>> {
  const { data } = await adminDb().from("integration_settings").select("key, value").in("key", [...DOC_SETTING_KEYS]);
  const saved = Object.fromEntries((data ?? []).map((r) => [r.key, r.value]));
  return { ...DOC_DEFAULTS, ...saved };
}

export async function saveDocSettings(values: DocSettings) {
  const db = adminDb();
  const now = new Date().toISOString();
  for (const [key, value] of Object.entries(values)) {
    if (!value) await db.from("integration_settings").delete().eq("key", key);
    else await db.from("integration_settings").upsert({ key, value, updated_at: now }, { onConflict: "key" });
  }
}

export async function getDoc(id: string) {
  const { data } = await adminDb().from("documents").select("*").eq("id", id).maybeSingle();
  return data as Doc | null;
}

// Alta con número correlativo por tipo y año (INV-2026-0007). Si dos se crean a la vez, reintenta.
export async function insertDoc(fields: Omit<Partial<Doc>, "id" | "number" | "token"> & { kind: DocKind }) {
  const db = adminDb();
  const year = (fields.issue_date ?? new Date().toISOString()).slice(0, 4);
  const prefix = `${KIND_PREFIX[fields.kind]}-${year}-`;
  const totals = docTotals({ items: fields.items ?? [], discount: fields.discount ?? 0, tax_rate: fields.tax_rate ?? 0, shipping: fields.shipping ?? 0 });
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: last } = await db.from("documents").select("number").like("number", `${prefix}%`).order("number", { ascending: false }).limit(1);
    const seq = (last?.[0] ? Number(String(last[0].number).slice(prefix.length)) : 0) + 1 + attempt;
    const { data, error } = await db
      .from("documents")
      .insert({ ...fields, subtotal: totals.subtotal, total: totals.total, number: `${prefix}${String(seq).padStart(4, "0")}`, token: randomBytes(18).toString("base64url") })
      .select("*")
      .single();
    if (!error) return data as Doc;
    if (error.code !== "23505") throw error;
  }
  throw new Error("No se pudo numerar el documento. Inténtalo de nuevo.");
}

const docLabel = (d: Pick<Doc, "kind" | "number">) => `${KIND_LABEL[d.kind]} ${d.number}`;

export async function docEvent(d: Doc, body: string, user: string) {
  if (d.customer_id) await addEvent(d.customer_id, "document", `${docLabel(d)}: ${body}`, { document: d.id }, user);
}

// El cliente avanza de etapa (nunca retrocede ni sale de «ganado»/«perdido»)
export async function advanceStage(customerId: string | null, to: Stage, user: string) {
  if (!customerId) return;
  const db = adminDb();
  const { data } = await db.from("customers").select("stage").eq("id", customerId).single();
  const from = data?.stage as Stage | undefined;
  if (!from || from === "lost" || STAGES.indexOf(from) >= STAGES.indexOf(to)) return;
  await db.from("customers").update({ stage: to, last_activity_at: new Date().toISOString() }).eq("id", customerId);
  await addEvent(customerId, "stage", `Etapa: ${STAGE_LABEL[to]}`, { from, to }, user);
}

async function stockFor(d: Doc) {
  const ids = d.items.map((l) => l.item_id).filter(Boolean) as string[];
  if (!ids.length) return [];
  const { data } = await adminDb().from("inventory_items").select("*").in("id", ids);
  return (data ?? []) as Item[];
}

// Memo entregado o factura emitida: los relojes quedan reservados (también en la web)
export async function reserveStock(d: Doc, user: string) {
  for (const item of await stockFor(d)) {
    if (item.status !== "in_stock") continue;
    await adminDb().from("inventory_items").update({ status: "reserved", updated_at: new Date().toISOString() }).eq("id", item.id);
    await logItem(item.id, "status", `Reservado por ${docLabel(d)}${d.client_name ? ` (${d.client_name})` : ""}`, user, { document: d.id });
    await syncWebStatus(item.watch_id, "reserved");
  }
}

// Memo devuelto o documento anulado: vuelven a estar disponibles
export async function releaseStock(d: Doc, user: string, why: string) {
  for (const item of await stockFor(d)) {
    if (item.status !== "reserved") continue;
    await adminDb().from("inventory_items").update({ status: "in_stock", updated_at: new Date().toISOString() }).eq("id", item.id);
    await logItem(item.id, "status", `Disponible de nuevo: ${why} (${docLabel(d)})`, user, { document: d.id });
    await syncWebStatus(item.watch_id, "available");
  }
}

// Factura pagada: cada reloj queda vendido al precio de su línea (con su parte del descuento)
export async function sellStock(d: Doc, user: string) {
  const { subtotal, discount } = docTotals(d);
  const items = await stockFor(d);
  for (const line of d.items) {
    // Reloj que entregó el cliente como parte del pago: entra al inventario como «Intercambio»
    if (line.trade) {
      await tradeInToStock(d, line, user).catch((e) => console.error("Intercambio al inventario:", e));
      continue;
    }
    const item = items.find((i) => i.id === line.item_id);
    if (!item || item.status === "returned") continue;
    if (item.status === "sold") {
      // Ya estaba vendido sin comprador (p. ej. marcado vendido antes de cobrar la factura): queda a nombre del cliente
      if (!item.buyer_customer_id && d.customer_id) {
        await adminDb().from("inventory_items").update({ buyer_customer_id: d.customer_id, buyer_name: item.buyer_name ?? d.client_name, updated_at: new Date().toISOString() }).eq("id", item.id);
        await logItem(item.id, "sale", `Comprador: ${d.client_name ?? "cliente"} · ${docLabel(d)}`, user, { document: d.id });
      }
      continue;
    }
    const amount = line.qty * line.price;
    const price = Math.round((amount - (subtotal ? (discount * amount) / subtotal : 0)) * 100) / 100;
    const saleDate = d.paid_at ?? new Date().toISOString().slice(0, 10);
    await adminDb()
      .from("inventory_items")
      .update({ status: "sold", sale_date: saleDate, sale_price: price, buyer_customer_id: d.customer_id, buyer_name: d.client_name, payment_method: d.payment_method, sold_by: d.created_by && /@/.test(d.created_by) ? d.created_by : null, updated_at: new Date().toISOString() })
      .eq("id", item.id);
    await logItem(item.id, "sale", `Vendido a ${d.client_name ?? "cliente"} por $${price.toLocaleString("en-US")} · ${docLabel(d)}`, user, { document: d.id });
    await recordPurchase(d.customer_id, { ...item, sale_price: price, sale_date: saleDate }, user);
    await syncWebStatus(item.watch_id, "sold");
    if (isOwnerStock(item.acquisition)) await logItem(item.id, "owed", `Pendiente de pagar al dueño: $${Number(item.cost ?? 0).toLocaleString("en-US")}`, user);
  }
}

// Consignación terminada sin vender: el reloj sale del inventario y de la web
export async function returnConsigned(d: Doc, user: string) {
  for (const item of await stockFor(d)) {
    if (item.status !== "in_stock" && item.status !== "reserved") continue;
    await adminDb()
      .from("inventory_items")
      .update({ status: "returned", return_date: new Date().toISOString().slice(0, 10), return_reason: `Devuelto al dueño (${docLabel(d)})`, updated_at: new Date().toISOString() })
      .eq("id", item.id);
    await logItem(item.id, "return", `Devuelto al consignante · ${docLabel(d)}`, user, { document: d.id });
    await syncWebStatus(item.watch_id, "draft");
  }
}

// Pagado al dueño: queda marcado en cada reloj vendido de la consignación
export async function markOwnersPaid(d: Doc, user: string, paidAt: string) {
  for (const item of await stockFor(d)) {
    if (item.owner_paid_at) continue;
    await adminDb().from("inventory_items").update({ owner_paid_at: paidAt }).eq("id", item.id);
    await logItem(item.id, "owner_paid", `Pagado al dueño · ${docLabel(d)}`, user, { document: d.id });
  }
}

// ───────────────────── Pasos de cada documento (CRM y Telegram) ─────────────────────
const touch = (id: string, fields: Record<string, unknown>) =>
  adminDb().from("documents").update({ ...fields, updated_at: new Date().toISOString() }).eq("id", id);
const isoToday = () => new Date().toISOString().slice(0, 10);

// Enviado / entregado / firmado
export async function issueDoc(d: Doc, user: string) {
  await touch(d.id, { status: "sent" });
  if (d.kind === "sourcing") {
    await docEvent(d, `encargo firmado: busca ${d.items.map((l) => l.title).join(", ")} hasta ${usd(d.total)} · anticipo ${usd(d.deposit ?? 0)}`, user);
    await advanceStage(d.customer_id, "negotiating", user);
    await sourcingAlert(d, true);
  } else if (d.kind === "purchase") {
    await docEvent(d, `contrato de compra firmado (${usd(d.total)})`, user);
  } else if (d.kind === "consignment") {
    await docEvent(d, `contrato firmado (neto al dueño ${usd(d.total)})`, user);
  } else if (d.kind === "quote") {
    await docEvent(d, `enviada (${usd(d.total)})`, user);
    await advanceStage(d.customer_id, "negotiating", user);
  } else {
    await reserveStock(d, user);
    await docEvent(d, d.kind === "memo" ? `reloj entregado en memo (${usd(d.total)})` : `emitida por ${usd(d.total)}`, user);
    await advanceStage(d.customer_id, "negotiating", user);
  }
}

// Memo devuelto, o consignación terminada sin vender: se cierra y se genera el acta de devolución
export async function closeReturned(d: Doc, user: string, note: string | null = null) {
  await touch(d.id, { status: "returned" });
  if (d.kind === "memo") {
    await releaseStock(d, user, "devuelto del memo");
    await docEvent(d, "reloj devuelto", user);
  } else {
    await returnConsigned(d, user);
    await docEvent(d, "reloj devuelto a su dueño", user);
  }
  return createReturnReceipt(
    {
      of: d.kind === "memo" ? "memo" : "consignment",
      customerId: d.customer_id, clientName: d.client_name, clientPhone: d.client_phone, clientEmail: d.client_email, clientAddress: d.client_address,
      lang: d.lang, items: d.items.map((l) => ({ ...l, price: 0 })), sourceId: d.id, sourceNumber: d.number, note,
    },
    user
  );
}

// Acta de devolución: constancia para que la firme la otra parte (consignante o quien devuelve el memo)
export async function createReturnReceipt(
  r: {
    of: "consignment" | "memo";
    customerId: string | null;
    clientName: string | null;
    clientPhone?: string | null;
    clientEmail?: string | null;
    clientAddress?: string | null;
    lang?: "en" | "es";
    items: Doc["items"];
    sourceId?: string | null;
    sourceNumber?: string | null;
    note?: string | null;
  },
  user: string
) {
  const lang = r.lang ?? "en";
  const doc = await insertDoc({
    kind: "return",
    customer_id: r.customerId,
    client_name: r.clientName, client_phone: r.clientPhone ?? null, client_email: r.clientEmail ?? null, client_address: r.clientAddress ?? null,
    lang,
    issue_date: isoToday(),
    items: r.items.map((l) => ({ ...l, qty: l.qty || 1, price: 0 })),
    show_serial: true,
    return_of: r.of,
    notes: r.note,
    terms: returnTerms(r.of, lang, r.sourceNumber ?? null),
    source_id: r.sourceId ?? null,
    created_by: user,
  });
  await touch(doc.id, { status: "sent" });
  await docEvent(doc, r.of === "memo" ? "reloj recibido de vuelta del memo" : "reloj devuelto a su dueño", user);
  return { ...doc, status: "sent" as const };
}

export async function consignorPaid(d: Doc, user: string) {
  const paidAt = isoToday();
  await touch(d.id, { status: "paid", paid_at: paidAt });
  await markOwnersPaid(d, user, paidAt);
  await docEvent(d, `pagado al dueño (${usd(d.total)})`, user);
}

// Cotización aceptada o memo que el cliente se queda → factura con los mismos datos
export async function toInvoice(d: Doc, user: string) {
  const settings = await getDocSettings();
  const invoice = await insertDoc({
    kind: "invoice",
    customer_id: d.customer_id,
    client_name: d.client_name, client_company: d.client_company, client_email: d.client_email, client_phone: d.client_phone, client_address: d.client_address,
    lang: d.lang,
    issue_date: isoToday(),
    due_date: isoToday(),
    items: d.items,
    discount: d.discount,
    tax_rate: d.tax_rate,
    shipping: d.shipping,
    show_serial: true,
    notes: d.notes,
    terms: termsFor("invoice", d.lang, settings),
    payment_method: d.payment_method,
    source_id: d.id,
    created_by: user,
  });
  await touch(d.id, { status: "converted" });
  await docEvent(d, `convertida en la factura ${invoice.number}`, user);
  await docEvent(invoice, `creada desde ${KIND_LABEL[d.kind].toLowerCase()} ${d.number}`, user);
  return invoice;
}

// Factura pagada: relojes vendidos, cliente ganado y aviso al equipo
export async function payInvoice(d: Doc, method: string | null, paidAt: string, user: string) {
  await touch(d.id, { status: "paid", paid_at: paidAt, payment_method: method });
  const paid = { ...d, status: "paid" as const, paid_at: paidAt, payment_method: method };
  await sellStock(paid, user);
  await docEvent(paid, `pagada (${usd(d.total)}${method ? ` · ${method}` : ""})`, user);
  if (d.customer_id) await adminDb().from("customers").update({ stage: "won", last_activity_at: new Date().toISOString() }).eq("id", d.customer_id);
  await import("./push").then((p) => p.pushTeam({ title: `💰 Factura pagada · ${d.number}`, body: `${d.client_name ?? "Cliente"} · ${usd(d.total)}`, url: `/admin/documentos/${d.id}` }, "documentos")).catch(() => {});
  await notifyAdmins(`💰 <b>Factura pagada · ${h(d.number)}</b>\n${h(d.client_name ?? "Cliente")} · <b>${usd(d.total)}</b>${method ? ` · ${h(method)}` : ""}\n${h(d.items.map((l) => l.title).join(", "))}`).catch(() => {});
  return paid;
}

export async function voidDoc(d: Doc, user: string) {
  await touch(d.id, { status: "void" });
  if (d.kind === "sourcing") await sourcingAlert(d, false);
  if (d.status === "sent" && (d.kind === "memo" || d.kind === "invoice" || d.kind === "proforma")) await releaseStock(d, user, "documento anulado");
  if (d.kind === "proforma" && paidSoFar(d) > 0) {
    await touch(d.id, { refunded_at: isoToday() });
    await docEvent(d, `anulada con ${usd(paidSoFar(d))} en depósitos: devolverlos al cliente`, user);
  }
  await docEvent(d, "anulada", user);
}

// ───────────────────── Encargos con anticipo ─────────────────────
// El reloj buscado queda como búsqueda «avísenme» del cliente: así sale en Demanda y avisa cuando
// entra al inventario una pieza que encaja. Se desactiva al cerrar el encargo.
async function sourcingAlert(d: Doc, active: boolean) {
  if (!d.customer_id) return;
  const db = adminDb();
  for (const l of d.items) {
    const query = l.title.slice(0, 120);
    const { data: found } = await db.from("watch_alerts").select("id").eq("customer_id", d.customer_id).eq("query", query).limit(1).maybeSingle();
    if (found) await db.from("watch_alerts").update({ active }).eq("id", found.id);
    else if (active) await db.from("watch_alerts").insert({ customer_id: d.customer_id, query });
  }
}

export async function depositReceived(d: Doc, method: string | null, paidAt: string, user: string) {
  await touch(d.id, { deposit_paid_at: paidAt, deposit_method: method });
  await docEvent(d, `anticipo recibido: ${usd(d.deposit ?? 0)}${method ? ` · ${method}` : ""}`, user);
  await import("./push").then((p) => p.pushTeam({ title: `💵 Anticipo recibido · ${d.number}`, body: `${d.client_name ?? "Cliente"} · ${usd(d.deposit ?? 0)}`, url: `/admin/documentos/${d.id}` }, "documentos")).catch(() => {});
  await notifyAdmins(`💵 <b>Anticipo recibido · ${h(d.number)}</b>\n${h(d.client_name ?? "Cliente")} · <b>${usd(d.deposit ?? 0)}</b>${method ? ` · ${h(method)}` : ""}\nBusca: ${h(d.items.map((l) => l.title).join(", "))}`).catch(() => {});
}

// No se consiguió (o el cliente cancela): se le devuelve el anticipo íntegro
export async function refundDeposit(d: Doc, user: string) {
  await touch(d.id, { status: "returned", refunded_at: isoToday() });
  await sourcingAlert(d, false);
  await docEvent(d, d.deposit_paid_at ? `anticipo devuelto (${usd(d.deposit ?? 0)})` : "encargo cerrado sin anticipo", user);
}

// Conseguido: factura con el reloj (del inventario o descrito a mano) y el anticipo descontado del saldo
export async function sourcingToInvoice(d: Doc, line: Doc["items"][number], user: string) {
  const settings = await getDocSettings();
  const deposit = d.deposit_paid_at ? Number(d.deposit ?? 0) : 0;
  const invoice = await insertDoc({
    kind: "invoice",
    customer_id: d.customer_id,
    client_name: d.client_name, client_company: d.client_company, client_email: d.client_email, client_phone: d.client_phone, client_address: d.client_address,
    lang: d.lang,
    issue_date: isoToday(),
    due_date: isoToday(),
    items: [line],
    tax_rate: Number(settings.doc_tax_rate) || 0,
    show_serial: true,
    deposit,
    notes: deposit ? (d.lang === "es" ? `Anticipo del encargo ${d.number} descontado.` : `Deposit from sourcing agreement ${d.number} applied.`) : null,
    terms: termsFor("invoice", d.lang, settings),
    payment_method: d.payment_method,
    source_id: d.id,
    created_by: user,
  });
  await touch(d.id, { status: "converted" });
  await sourcingAlert(d, false);
  await docEvent(d, `conseguido: factura ${invoice.number}${deposit ? ` con el anticipo de ${usd(deposit)} descontado` : ""}`, user);
  return invoice;
}

// Opciones del formulario: clientes del CRM y relojes disponibles del inventario
export async function formOptions() {
  const db = adminDb();
  const [customers, stock] = await Promise.all([
    db.from("customers").select("id, name, phone, email").order("last_activity_at", { ascending: false }).limit(500),
    db.from("inventory_items").select("id, sku, brand, model, reference, serial, condition, comes_with, papers_date, asking_price, cost").in("status", ["in_stock", "reserved"]).order("sku"),
  ]);
  return {
    customers: (customers.data ?? []).map((c) => ({
      id: c.id as string, name: c.name as string | null, email: c.email as string | null, phone: c.phone as string | null,
      label: [c.name ?? "Sin nombre", c.phone ?? c.email].filter(Boolean).join(" · "),
    })),
    stock: (stock.data ?? []).map((i) => ({
      id: i.id as string,
      sku: i.sku as string,
      title: [i.brand, i.model, i.reference].filter(Boolean).join(" "),
      details: [i.condition, i.papers_date ? `Papers ${String(i.papers_date).slice(0, 7)}` : null, i.comes_with].filter(Boolean).join(" · "),
      serial: i.serial as string | null,
      price: i.asking_price == null ? null : Number(i.asking_price),
      cost: i.cost == null ? null : Number(i.cost),
    })),
  };
}

// ───────────────────── Vender desde el inventario = factura pagada ─────────────────────
// Si el reloj ya tiene una factura abierta, se cobra esa; si no, se crea la factura con los datos de la
// venta y se marca pagada. En los dos casos payInvoice deja el reloj vendido (inventario y web),
// el cliente ganado y el aviso al equipo: Documentos e inventario quedan siempre iguales.
export type Sale = {
  price: number; // precio del reloj, sin impuesto
  date: string; // AAAA-MM-DD
  method: string | null;
  customerId: string | null;
  clientName: string | null;
  clientPhone?: string | null;
  clientEmail?: string | null;
  taxRate: number; // % (0 si es dealer con certificado de reventa o se envía fuera de Florida)
  soldBy?: string | null; // correo del vendedor (comisión)
  lang?: "en" | "es";
};

export async function openInvoiceFor(itemId: string) {
  const { data } = await adminDb().from("documents").select("*").eq("kind", "invoice").in("status", ["draft", "sent"]).filter("items", "cs", JSON.stringify([{ item_id: itemId }])).order("created_at", { ascending: false }).limit(1);
  return (data?.[0] as Doc | undefined) ?? null;
}

export async function sellViaInvoice(itemId: string, sale: Sale, user: string) {
  // Proforma abierta: la venta la cierra (el saldo es el último pago)
  const { data: pf } = await adminDb().from("documents").select("*").eq("kind", "proforma").in("status", ["draft", "sent"]).filter("items", "cs", JSON.stringify([{ item_id: itemId }])).order("created_at", { ascending: false }).limit(1);
  if (pf?.[0]) return closeProforma(pf[0] as Doc, { date: sale.date, method: sale.method }, user);
  const open = await openInvoiceFor(itemId);
  if (open) {
    if (open.status === "draft") await issueDoc(open, user);
    return payInvoice({ ...open, status: "sent" }, sale.method ?? open.payment_method, sale.date, user);
  }
  const { data: i } = await adminDb().from("inventory_items").select("id, sku, brand, model, reference, serial, condition, comes_with, papers_date").eq("id", itemId).single();
  if (!i) throw new Error("Reloj no encontrado");
  const settings = await getDocSettings();
  const lang = sale.lang ?? "en";
  const invoice = await insertDoc({
    kind: "invoice",
    customer_id: sale.customerId,
    client_name: sale.clientName, client_phone: sale.clientPhone ?? null, client_email: sale.clientEmail ?? null,
    lang,
    issue_date: sale.date,
    due_date: sale.date,
    items: [{
      item_id: i.id, sku: i.sku, serial: i.serial, qty: 1, price: sale.price,
      title: [i.brand, i.model, i.reference].filter(Boolean).join(" "),
      details: [i.condition, i.papers_date ? `Papers ${String(i.papers_date).slice(0, 7)}` : null, i.comes_with].filter(Boolean).join(" · ") || null,
    }],
    tax_rate: sale.taxRate,
    show_serial: true,
    payment_method: sale.method,
    terms: termsFor("invoice", lang, settings),
    created_by: sale.soldBy && /@/.test(sale.soldBy) ? sale.soldBy : user,
  });
  await docEvent(invoice, `creada al vender ${i.sku} desde el inventario`, user);
  await touch(invoice.id, { status: "sent" });
  return payInvoice({ ...invoice, status: "sent" }, sale.method, sale.date, user);
}

// ───────────────────── Factura proforma ─────────────────────
// Cotización aceptada → proforma (reserva el reloj) → depósitos → saldada: factura pagada con los
// depósitos descontados y el reloj vendido.
export async function toProforma(d: Doc, user: string) {
  const settings = await getDocSettings();
  const due = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
  const pf = await insertDoc({
    kind: "proforma",
    customer_id: d.customer_id,
    client_name: d.client_name, client_company: d.client_company, client_email: d.client_email, client_phone: d.client_phone, client_address: d.client_address,
    lang: d.lang,
    issue_date: isoToday(),
    due_date: due,
    items: d.items,
    discount: d.discount,
    tax_rate: d.tax_rate,
    shipping: d.shipping,
    show_serial: d.show_serial,
    notes: d.notes,
    terms: termsFor("proforma", d.lang, settings),
    payment_method: d.payment_method,
    source_id: d.id,
    created_by: user,
  });
  await touch(d.id, { status: "converted" });
  await docEvent(d, `aceptada: proforma ${pf.number}`, user);
  await docEvent(pf, `creada desde la cotización ${d.number}`, user);
  return pf;
}

export async function addProformaPayment(d: Doc, p: DocPayment, user: string) {
  if (d.status === "draft") await issueDoc(d, user); // con el primer depósito queda emitida y el reloj reservado
  const payments = [...(d.payments ?? []), { date: p.date, amount: Math.round(p.amount * 100) / 100, method: p.method }];
  const paid = paidSoFar({ payments });
  await touch(d.id, { status: "sent", payments, deposit: paid, deposit_paid_at: p.date, deposit_method: p.method });
  const balance = Math.max(0, Math.round((Number(d.total) - paid) * 100) / 100);
  await docEvent(d, `depósito de ${usd(p.amount)}${p.method ? ` (${p.method})` : ""} · pagado ${usd(paid)} · saldo ${usd(balance)}`, user);
  await import("./push").then((x) => x.pushTeam({ title: `💵 Depósito recibido · ${d.number}`, body: `${d.client_name ?? "Cliente"} · ${usd(p.amount)} · saldo ${usd(balance)}`, url: `/admin/documentos/${d.id}` }, "documentos")).catch(() => {});
  await notifyAdmins(`💵 <b>Depósito recibido · ${h(d.number)}</b>\n${h(d.client_name ?? "Cliente")} · <b>${usd(p.amount)}</b>${p.method ? ` · ${h(p.method)}` : ""}\nPagado ${usd(paid)} de ${usd(d.total)} · saldo <b>${usd(balance)}</b>`).catch(() => {});
  return { ...d, status: "sent" as const, payments, deposit: paid, balance };
}

// Saldada: el saldo es el último pago; se emite la factura (pagada) con los depósitos descontados
export async function closeProforma(d: Doc, p: { date: string; method: string | null }, user: string) {
  const before = paidSoFar(d);
  const balance = Math.max(0, Math.round((Number(d.total) - before) * 100) / 100);
  const payments = balance > 0 ? [...(d.payments ?? []), { date: p.date, amount: balance, method: p.method }] : d.payments ?? [];
  const settings = await getDocSettings();
  const methods = [...new Set(payments.map((x) => x.method).filter(Boolean))].join(" + ") || p.method;
  const list = payments.map((x) => `${x.date} ${usd(x.amount)}${x.method ? ` ${x.method}` : ""}`).join(" · ");
  const invoice = await insertDoc({
    kind: "invoice",
    customer_id: d.customer_id,
    client_name: d.client_name, client_company: d.client_company, client_email: d.client_email, client_phone: d.client_phone, client_address: d.client_address,
    lang: d.lang,
    issue_date: p.date,
    due_date: p.date,
    items: d.items,
    discount: d.discount,
    tax_rate: d.tax_rate,
    shipping: d.shipping,
    show_serial: true,
    deposit: before,
    payments,
    notes: [d.notes, d.lang === "es" ? `Proforma ${d.number}. Pagos: ${list}` : `Proforma ${d.number}. Payments: ${list}`].filter(Boolean).join("\n"),
    terms: termsFor("invoice", d.lang, settings),
    payment_method: methods,
    source_id: d.id,
    created_by: d.created_by ?? user,
  });
  await touch(d.id, { status: "converted", payments, deposit: paidSoFar({ payments }) });
  await docEvent(d, `saldada: factura ${invoice.number}`, user);
  await docEvent(invoice, `creada al saldar la proforma ${d.number}`, user);
  await touch(invoice.id, { status: "sent" });
  return payInvoice({ ...invoice, status: "sent" }, methods ?? null, p.date, user);
}

// Acta de devolución de un reloj del inventario que no tenía contrato (consignación o memo de dealer)
export async function receiptForItem(item: Pick<Item, "id" | "sku" | "brand" | "model" | "reference" | "serial" | "condition" | "comes_with" | "supplier_customer_id" | "supplier_name">, note: string | null, user: string) {
  const { data: c } = item.supplier_customer_id ? await adminDb().from("customers").select("name, phone, email").eq("id", item.supplier_customer_id).maybeSingle() : { data: null };
  return createReturnReceipt(
    {
      of: "consignment",
      customerId: item.supplier_customer_id ?? null,
      clientName: item.supplier_name ?? c?.name ?? null,
      clientPhone: c?.phone ?? null,
      clientEmail: c?.email ?? null,
      items: [{ item_id: item.id, sku: item.sku, title: [item.brand, item.model, item.reference].filter(Boolean).join(" "), details: [item.condition, item.comes_with].filter(Boolean).join(" · ") || null, serial: item.serial, qty: 1, price: 0 }],
      note,
    },
    user
  );
}

// Intercambio de una factura pagada → inventario (costo = valor reconocido; proveedor = el cliente)
async function tradeInToStock(d: Doc, line: DocLine, user: string) {
  const words = line.title.replace(/^(trade-in|intercambio)\s*:?\s*/i, "").trim().split(/\s+/);
  const refIdx = words.findIndex((w, i) => i > 0 && /\d/.test(w) && w.length >= 4);
  const reference = refIdx > 0 ? words.splice(refIdx, 1)[0] : null;
  const { createStockItem } = await import("./stock");
  await createStockItem(
    {
      acquisition: "trade",
      brand: words.shift() ?? "?",
      model: words.join(" ") || null,
      reference,
      serial: line.serial ?? null,
      comes_with: line.details ?? null,
      supplier_customer_id: d.customer_id,
      supplier_name: d.client_name,
      purchase_date: d.paid_at ?? new Date().toISOString().slice(0, 10),
      cost: Math.abs(Number(line.price)),
    },
    user,
    `Entrada por intercambio en ${docLabel(d)} · valor ${usd(Math.abs(Number(line.price)))}`
  );
}
