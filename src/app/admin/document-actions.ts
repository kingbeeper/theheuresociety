"use server";

import { tr } from "@/lib/admin-i18n";
import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { adminDb } from "@/lib/supabase";
import { upsertLead } from "@/lib/crm";
import { addProformaPayment, closeProforma, closeReturned, consignorPaid, depositReceived, toProforma, docEvent, getDoc, insertDoc, issueDoc, payInvoice, refundDeposit, reserveStock, saveDocSettings, sourcingToInvoice, toInvoice, voidDoc } from "@/lib/documents";
import { DOC_SETTING_KEYS, INSPECTION_PARTS, KIND_LABEL, docTotals, usd, type DocKind, type DocLine, type Inspection, type PartState } from "@/lib/doc-labels";

// Acciones de cotizaciones, memos y facturas. Todas comprueban la sesión.

const text = (f: FormData, k: string) => {
  const v = String(f.get(k) ?? "").trim();
  return v || null;
};
const num = (f: FormData, k: string) => {
  const n = Number(String(f.get(k) ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const date = (f: FormData, k: string) => {
  const v = text(f, k);
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
};
const today = () => new Date().toISOString().slice(0, 10);

// Ficha de inspección: estado de cada parte, funcionamiento, set y fotos (rutas privadas)
function parseInspection(f: FormData): Inspection {
  const state = (v: FormDataEntryValue | null): PartState => (["ok", "wear", "damage", "na"].includes(String(v)) ? (String(v) as PartState) : "ok");
  let photos: string[] = [];
  try {
    photos = (JSON.parse(String(f.get("insp_photos") ?? "[]")) as string[]).filter((p) => typeof p === "string" && p.startsWith("inspections/")).slice(0, 12);
  } catch {}
  const runs = String(f.get("insp_runs") ?? "");
  return {
    direction: f.get("insp_dir") === "out" ? "out" : "in",
    parts: Object.fromEntries(INSPECTION_PARTS.map((p) => [p, state(f.get(`insp_${p}`))])),
    runs: runs === "yes" ? true : runs === "no" ? false : null,
    rate: text(f, "insp_rate"),
    power_reserve: text(f, "insp_power"),
    links: text(f, "insp_links"),
    box: f.get("insp_box") === "on",
    papers: f.get("insp_papers") === "on",
    extras: text(f, "insp_extras"),
    notes: text(f, "insp_notes"),
    photos,
  };
}

function parseService(f: FormData) {
  let photos: string[] = [];
  try {
    photos = (JSON.parse(String(f.get("svc_photos") ?? "[]")) as string[]).filter((p) => typeof p === "string" && p.startsWith("inspections/")).slice(0, 12);
  } catch {}
  const cost = text(f, "svc_cost");
  return {
    piece: text(f, "svc_piece") ?? "",
    provider: text(f, "svc_provider"),
    provider_cost: cost ? Number(cost.replace(/[^\d.]/g, "")) || null : null,
    promised: date(f, "due_date"),
    photos,
  };
}

function parseLines(raw: string | null): DocLine[] {
  try {
    const rows = JSON.parse(raw ?? "[]") as DocLine[];
    return rows
      .map((l) => ({
        item_id: l.trade ? null : l.item_id || null,
        sku: l.trade ? null : l.sku || null,
        // Intercambio: el reloj que entrega el cliente resta del total
        title: l.trade && l.title && !/^(trade-in|intercambio)/i.test(String(l.title).trim()) ? `Trade-in: ${String(l.title).trim()}`.slice(0, 200) : String(l.title ?? "").trim().slice(0, 200),
        ...(l.trade && { trade: true }),
        details: String(l.details ?? "").trim().slice(0, 500) || null,
        serial: String(l.serial ?? "").trim().slice(0, 80) || null,
        qty: Math.max(1, Math.round(Number(l.qty) || 1)),
        price: (l.trade ? -1 : 1) * Math.round(Math.abs(Number(l.price) || 0) * 100) / 100,
      }))
      .filter((l) => l.title);
  } catch {
    return [];
  }
}

export async function saveDocument(id: string | null, _: unknown, f: FormData) {
  const user = await requireAdmin("documentos");
  const kind = (text(f, "kind") ?? "quote") as DocKind;
  if (!(kind in KIND_LABEL)) return { error: tr("Tipo de documento no válido.") };
  const items = parseLines(text(f, "items"));
  if (!items.length) return { error: tr("Añade al menos un reloj o una línea.") };

  // Cliente: uno del CRM, o uno nuevo que queda creado como lead
  let customerId = text(f, "customer_id");
  if (!customerId && text(f, "client_name")) {
    const c = await upsertLead({ name: text(f, "client_name"), phone: text(f, "client_phone"), email: text(f, "client_email"), source: "walk_in", intent: kind === "memo" ? null : "buy", notify: false });
    customerId = c.id;
  }
  if (!customerId && !text(f, "client_name")) return { error: tr("Falta el cliente.") };

  const fields = {
    kind,
    customer_id: customerId,
    client_name: text(f, "client_name"),
    client_company: text(f, "client_company"),
    client_email: text(f, "client_email"),
    client_phone: text(f, "client_phone"),
    client_address: text(f, "client_address"),
    lang: text(f, "lang") === "es" ? ("es" as const) : ("en" as const),
    issue_date: date(f, "issue_date") ?? today(),
    due_date: kind === "purchase" || kind === "inspection" ? null : date(f, "due_date"),
    ...(kind === "inspection" && { inspection: parseInspection(f) }),
    ...(kind === "sourcing" && { deposit: Math.max(0, num(f, "deposit")) }),
    ...(kind === "purchase" && {
      seller_id_type: text(f, "seller_id_type"),
      seller_id_number: text(f, "seller_id_number"),
      seller_dob: date(f, "seller_dob"),
    }),
    items,
    discount: num(f, "discount"),
    tax_rate: num(f, "tax_rate"),
    shipping: num(f, "shipping"),
    show_serial: f.get("show_serial") === "on",
    notes: text(f, "notes"),
    terms: text(f, "terms"),
    payment_method: text(f, "payment_method"),
  };

  // Orden de servicio: la pieza, el taller y su costo, la fecha prometida y las fotos (el estado se conserva)
  const svc = kind === "service" ? parseService(f) : null;

  if (!id) {
    const doc = await insertDoc({ ...fields, ...(svc && { service: (await import("@/lib/service")).newService(svc) }), created_by: user });
    await docEvent(doc, `creada por ${usd(doc.total)}`, user);
    redirect(`/admin/documentos/${doc.id}`);
  }

  const before = await getDoc(id);
  if (!before) return { error: tr("No existe.") };
  if (!["draft", "sent"].includes(before.status)) return { error: tr("Este documento ya está cerrado y no se puede editar.") };
  const totals = docTotals(fields);
  const { error } = await adminDb().from("documents").update({ ...fields, ...(svc && before.service && { service: { ...before.service, ...svc } }), kind: before.kind, subtotal: totals.subtotal, total: totals.total, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return { error: error.message };
  // Ya entregado: si se añadieron relojes, también se reservan
  if (before.status === "sent" && (before.kind === "memo" || before.kind === "invoice")) await reserveStock({ ...before, ...fields, kind: before.kind }, user);
  refresh();
  return { ok: true };
}

// Marcar como enviado / entregado / firmado
export async function sendDocument(id: string) {
  const user = await requireAdmin("documentos");
  const d = await getDoc(id);
  if (!d || d.status !== "draft") return;
  await issueDoc(d, user);
  refresh();
}

export async function setQuoteResult(id: string, accepted: boolean) {
  const user = await requireAdmin("documentos");
  const d = await getDoc(id);
  if (!d || d.kind !== "quote") return;
  await adminDb().from("documents").update({ status: accepted ? "accepted" : "rejected", updated_at: new Date().toISOString() }).eq("id", id);
  await docEvent(d, accepted ? "aceptada" : "rechazada", user);
  refresh();
}

export async function returnMemo(id: string) {
  const user = await requireAdmin("documentos");
  const d = await getDoc(id);
  if (!d || (d.kind !== "memo" && d.kind !== "consignment") || d.status !== "sent") return;
  const receipt = await closeReturned(d, user);
  redirect(`/admin/documentos/${receipt.id}`);
}

// Consignación: se vendió el reloj y se pagó al dueño
export async function markConsignorPaid(id: string) {
  const user = await requireAdmin("documentos");
  const d = await getDoc(id);
  if (!d || d.kind !== "consignment" || d.status !== "sent") return;
  await consignorPaid(d, user);
  refresh();
}

export async function convertToInvoice(id: string) {
  const user = await requireAdmin("documentos");
  const d = await getDoc(id);
  if (!d || d.kind === "invoice" || d.kind === "consignment" || d.kind === "purchase" || d.kind === "sourcing" || d.kind === "proforma") return;
  const invoice = await toInvoice(d, user);
  redirect(`/admin/documentos/${invoice.id}`);
}

export async function markPaid(id: string, _: unknown, f: FormData) {
  const user = await requireAdmin("documentos");
  const d = await getDoc(id);
  if (!d || d.kind !== "invoice" || d.status === "paid" || d.status === "void") return { error: tr("Esta factura no se puede marcar como pagada.") };
  await payInvoice(d, text(f, "payment_method"), date(f, "paid_at") ?? today(), user);
  refresh();
  return { ok: true };
}

// ───────────────────── Proforma ─────────────────────
// Cotización aceptada → proforma con los mismos datos (el reloj queda reservado al emitirla)
export async function convertToProforma(id: string) {
  const user = await requireAdmin("documentos");
  const d = await getDoc(id);
  if (!d || d.kind !== "quote" || !["draft", "sent", "accepted"].includes(d.status)) return;
  const pf = await toProforma(d, user);
  redirect(`/admin/documentos/${pf.id}`);
}

export async function proformaPaymentAction(id: string, _: unknown, f: FormData) {
  const user = await requireAdmin("documentos");
  const d = await getDoc(id);
  if (!d || d.kind !== "proforma" || !["draft", "sent"].includes(d.status)) return { error: tr("Esta proforma ya está cerrada.") };
  const amount = num(f, "amount");
  if (amount <= 0) return { error: tr("Indica el importe del depósito.") };
  await addProformaPayment(d, { date: date(f, "paid_at") ?? today(), amount, method: text(f, "payment_method") }, user);
  refresh();
  return { ok: true };
}

// Saldada: el saldo se registra como último pago y se emite la factura pagada
export async function closeProformaAction(id: string, _: unknown, f: FormData) {
  const user = await requireAdmin("documentos");
  const d = await getDoc(id);
  if (!d || d.kind !== "proforma" || !["draft", "sent"].includes(d.status)) return { error: tr("Esta proforma ya está cerrada.") };
  if (d.status === "draft") await issueDoc(d, user);
  const invoice = await closeProforma({ ...d, status: "sent" }, { date: date(f, "paid_at") ?? today(), method: text(f, "payment_method") }, user);
  redirect(`/admin/documentos/${invoice.id}`);
}

// ───────────────────── Encargos ─────────────────────
export async function markDepositReceived(id: string, _: unknown, f: FormData) {
  const user = await requireAdmin("documentos");
  const d = await getDoc(id);
  if (!d || d.kind !== "sourcing" || d.deposit_paid_at || !["draft", "sent"].includes(d.status)) return { error: tr("Este anticipo ya está registrado.") };
  await depositReceived(d, text(f, "payment_method"), date(f, "paid_at") ?? today(), user);
  refresh();
  return { ok: true };
}

export async function refundSourcing(id: string) {
  const user = await requireAdmin("documentos");
  const d = await getDoc(id);
  if (!d || d.kind !== "sourcing" || d.status !== "sent") return;
  await refundDeposit(d, user);
  refresh();
}

// Conseguido: reloj del inventario (o descrito a mano) y precio final → factura con el anticipo descontado
export async function convertSourcing(id: string, _: unknown, f: FormData) {
  const user = await requireAdmin("documentos");
  const d = await getDoc(id);
  if (!d || d.kind !== "sourcing" || d.status !== "sent") return { error: tr("Este encargo ya está cerrado.") };
  const price = num(f, "price");
  if (price <= 0) return { error: tr("Indica el precio final del reloj.") };
  const itemId = text(f, "item_id");
  let line: DocLine = { title: d.items[0]?.title ?? "Timepiece", details: d.items[0]?.details ?? null, serial: text(f, "serial"), qty: 1, price };
  if (itemId) {
    const { data: i } = await adminDb().from("inventory_items").select("id, sku, brand, model, reference, serial, condition, comes_with, papers_date").eq("id", itemId).maybeSingle();
    if (!i) return { error: tr("Ese reloj ya no está en el inventario.") };
    line = {
      item_id: i.id, sku: i.sku, serial: i.serial, qty: 1, price,
      title: [i.brand, i.model, i.reference].filter(Boolean).join(" "),
      details: [i.condition, i.papers_date ? `Papers ${String(i.papers_date).slice(0, 7)}` : null, i.comes_with].filter(Boolean).join(" · ") || null,
    };
  }
  const invoice = await sourcingToInvoice(d, line, user);
  redirect(`/admin/documentos/${invoice.id}`);
}

export async function voidDocument(id: string) {
  const user = await requireAdmin("documentos");
  const d = await getDoc(id);
  if (!d || d.status === "paid") return;
  await voidDoc(d, user);
  refresh();
}

export async function deleteDocument(id: string) {
  await requireAdmin("documentos");
  const d = await getDoc(id);
  if (d?.status !== "draft") return;
  await adminDb().from("documents").delete().eq("id", id);
  redirect("/admin/documentos");
}

export async function saveDocumentSettings(_: unknown, f: FormData) {
  await requireAdmin("usuarios");
  await saveDocSettings(Object.fromEntries(DOC_SETTING_KEYS.map((k) => [k, String(f.get(k) ?? "").trim()])));
  refresh();
  return { ok: true };
}


// ───────────── Envíos ─────────────
export async function addShipmentAction(docId: string, f: FormData) {
  const user = await requireAdmin("documentos");
  const d = await getDoc(docId);
  if (!d) return;
  const { addShipment } = await import("@/lib/shipping");
  await addShipment(d, { carrier: text(f, "carrier"), tracking: text(f, "tracking") ?? "", note: text(f, "note"), notify: f.get("notify") === "1" }, user);
  refresh();
}

export async function shipmentDeliveredAction(id: string, f: FormData) {
  const user = await requireAdmin("documentos");
  const { markDelivered } = await import("@/lib/shipping");
  await markDelivered(id, f.get("notify") === "1", user);
  refresh();
}

export async function deleteShipmentAction(id: string) {
  await requireAdmin("documentos");
  const { deleteShipment } = await import("@/lib/shipping");
  await deleteShipment(id);
  refresh();
}

// ───────────── Cobros ─────────────
export async function remindPaymentAction(docId: string) {
  const user = await requireAdmin("documentos");
  const { receivables, remindClient } = await import("@/lib/collections");
  const d = (await receivables()).find((x) => x.id === docId);
  if (d) await remindClient(d, user, "email");
  refresh();
}

export async function remindedByWhatsAppAction(docId: string) {
  const user = await requireAdmin("documentos");
  const { receivables, remindClient } = await import("@/lib/collections");
  const d = (await receivables()).find((x) => x.id === docId);
  if (d) await remindClient(d, user, "whatsapp");
  refresh();
}

export async function toggleAutoRemindersAction() {
  await requireAdmin("documentos");
  const { AUTO_KEY, autoRemindersOn } = await import("@/lib/collections");
  const on = await autoRemindersOn();
  await adminDb().from("integration_settings").upsert({ key: AUTO_KEY, value: on ? "off" : "on", updated_at: new Date().toISOString() }, { onConflict: "key" });
  refresh();
}

// Tasar el reloj que entrega el cliente (≈ 1 minuto): mercado típico y cuánto reconocerle (15 % menos)
export async function appraiseTradeAction(title: string, details: string | null) {
  await requireAdmin("documentos");
  const words = title.replace(/^(trade-in|intercambio)\s*:?\s*/i, "").trim().split(/\s+/);
  if (!words[0]) return { error: tr("Escribe primero el reloj (marca, modelo y referencia).") };
  const refIdx = words.findIndex((w, i) => i > 0 && /\d/.test(w) && w.length >= 4);
  const reference = refIdx > 0 ? words.splice(refIdx, 1)[0] : null;
  const { checkMarket } = await import("@/lib/market");
  const m = await checkMarket({ id: "trade", sku: "", brand: words.shift()!, model: words.join(" ") || null, reference, condition: null, comes_with: details, papers_date: null, asking_price: null }).catch(() => null);
  if (!m?.typical) return { error: tr("No se encontraron anuncios comparables.") };
  return { typical: m.typical, low: m.low, high: m.high, suggested: Math.round((m.typical * 0.85) / 50) * 50 };
}

// Foto de la ficha de inspección (ya reducida en el navegador): al almacenamiento privado
export async function uploadInspectionPhotoAction(base64: string) {
  await requireAdmin("documentos");
  if (!base64 || base64.length > 1_400_000) return { error: tr("La foto es demasiado grande.") };
  const { uploadPrivate } = await import("@/lib/private-files");
  const path = `inspections/${crypto.randomUUID()}.jpg`;
  await uploadPrivate(path, Buffer.from(base64, "base64"), "image/jpeg");
  return { path };
}

// Orden de servicio: al taller, lista o entregada (entregada = factura pagada)
export async function serviceStepAction(id: string, step: "workshop" | "ready" | "delivered", f: FormData) {
  const user = await requireAdmin("documentos");
  const { serviceStep } = await import("@/lib/service");
  const r = await serviceStep(id, step, user, text(f, "payment_method"));
  refresh();
  if (r.invoice) redirect(`/admin/documentos/${r.invoice.id}`);
}
