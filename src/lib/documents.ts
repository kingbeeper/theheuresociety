import "server-only";
import { randomBytes } from "node:crypto";
import { adminDb } from "./supabase";
import { addEvent, STAGES, STAGE_LABEL, type Stage } from "./crm";
import { logItem, recordPurchase, syncWebStatus, type Item } from "./stock";
import { isOwnerStock } from "./stock-labels";
import { DOC_DEFAULTS, DOC_SETTING_KEYS, KIND_LABEL, KIND_PREFIX, docTotals, type Doc, type DocKind, type DocSettings } from "./doc-labels";

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
    const item = items.find((i) => i.id === line.item_id);
    if (!item || item.status === "sold" || item.status === "returned") continue;
    const amount = line.qty * line.price;
    const price = Math.round((amount - (subtotal ? (discount * amount) / subtotal : 0)) * 100) / 100;
    const saleDate = d.paid_at ?? new Date().toISOString().slice(0, 10);
    await adminDb()
      .from("inventory_items")
      .update({ status: "sold", sale_date: saleDate, sale_price: price, buyer_customer_id: d.customer_id, buyer_name: d.client_name, payment_method: d.payment_method, updated_at: new Date().toISOString() })
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
