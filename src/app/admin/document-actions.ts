"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { adminDb } from "@/lib/supabase";
import { upsertLead } from "@/lib/crm";
import { escapeHtml as h, notifyAdmins } from "@/lib/telegram";
import { advanceStage, docEvent, getDoc, getDocSettings, insertDoc, markOwnersPaid, releaseStock, reserveStock, returnConsigned, saveDocSettings, sellStock } from "@/lib/documents";
import { DOC_SETTING_KEYS, KIND_LABEL, docTotals, usd, type DocKind, type DocLine } from "@/lib/doc-labels";

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

function parseLines(raw: string | null): DocLine[] {
  try {
    const rows = JSON.parse(raw ?? "[]") as DocLine[];
    return rows
      .map((l) => ({
        item_id: l.item_id || null,
        sku: l.sku || null,
        title: String(l.title ?? "").trim().slice(0, 200),
        details: String(l.details ?? "").trim().slice(0, 500) || null,
        serial: String(l.serial ?? "").trim().slice(0, 80) || null,
        qty: Math.max(1, Math.round(Number(l.qty) || 1)),
        price: Math.round((Number(l.price) || 0) * 100) / 100,
      }))
      .filter((l) => l.title);
  } catch {
    return [];
  }
}

export async function saveDocument(id: string | null, _: unknown, f: FormData) {
  const user = await requireAdmin();
  const kind = (text(f, "kind") ?? "quote") as DocKind;
  if (!(kind in KIND_LABEL)) return { error: "Tipo de documento no válido." };
  const items = parseLines(text(f, "items"));
  if (!items.length) return { error: "Añade al menos un reloj o una línea." };

  // Cliente: uno del CRM, o uno nuevo que queda creado como lead
  let customerId = text(f, "customer_id");
  if (!customerId && text(f, "client_name")) {
    const c = await upsertLead({ name: text(f, "client_name"), phone: text(f, "client_phone"), email: text(f, "client_email"), source: "walk_in", intent: kind === "memo" ? null : "buy", notify: false });
    customerId = c.id;
  }
  if (!customerId && !text(f, "client_name")) return { error: "Falta el cliente." };

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
    due_date: date(f, "due_date"),
    items,
    discount: num(f, "discount"),
    tax_rate: num(f, "tax_rate"),
    shipping: num(f, "shipping"),
    show_serial: f.get("show_serial") === "on",
    notes: text(f, "notes"),
    terms: text(f, "terms"),
    payment_method: text(f, "payment_method"),
  };

  if (!id) {
    const doc = await insertDoc({ ...fields, created_by: user });
    await docEvent(doc, `creada por ${usd(doc.total)}`, user);
    redirect(`/admin/documentos/${doc.id}`);
  }

  const before = await getDoc(id);
  if (!before) return { error: "No existe." };
  if (!["draft", "sent"].includes(before.status)) return { error: "Este documento ya está cerrado y no se puede editar." };
  const totals = docTotals(fields);
  const { error } = await adminDb().from("documents").update({ ...fields, kind: before.kind, subtotal: totals.subtotal, total: totals.total, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return { error: error.message };
  // Ya entregado: si se añadieron relojes, también se reservan
  if (before.status === "sent" && (before.kind === "memo" || before.kind === "invoice")) await reserveStock({ ...before, ...fields, kind: before.kind }, user);
  refresh();
  return { ok: true };
}

// Marcar como enviado / entregado
export async function sendDocument(id: string) {
  const user = await requireAdmin();
  const d = await getDoc(id);
  if (!d || d.status !== "draft") return;
  await adminDb().from("documents").update({ status: "sent", updated_at: new Date().toISOString() }).eq("id", id);
  if (d.kind === "consignment") {
    await docEvent(d, `contrato firmado (neto al dueño ${usd(d.total)})`, user);
  } else if (d.kind === "quote") {
    await docEvent(d, `enviada (${usd(d.total)})`, user);
    await advanceStage(d.customer_id, "negotiating", user);
  } else {
    await reserveStock(d, user);
    await docEvent(d, d.kind === "memo" ? `reloj entregado en memo (${usd(d.total)})` : `emitida por ${usd(d.total)}`, user);
    await advanceStage(d.customer_id, "negotiating", user);
  }
  refresh();
}

export async function setQuoteResult(id: string, accepted: boolean) {
  const user = await requireAdmin();
  const d = await getDoc(id);
  if (!d || d.kind !== "quote") return;
  await adminDb().from("documents").update({ status: accepted ? "accepted" : "rejected", updated_at: new Date().toISOString() }).eq("id", id);
  await docEvent(d, accepted ? "aceptada" : "rechazada", user);
  refresh();
}

export async function returnMemo(id: string) {
  const user = await requireAdmin();
  const d = await getDoc(id);
  if (!d || (d.kind !== "memo" && d.kind !== "consignment")) return;
  await adminDb().from("documents").update({ status: "returned", updated_at: new Date().toISOString() }).eq("id", id);
  if (d.kind === "memo") {
    await releaseStock(d, user, "devuelto del memo");
    await docEvent(d, "reloj devuelto", user);
  } else {
    await returnConsigned(d, user);
    await docEvent(d, "reloj devuelto a su dueño", user);
  }
  refresh();
}

// Consignación: se vendió el reloj y se pagó al dueño
export async function markConsignorPaid(id: string) {
  const user = await requireAdmin();
  const d = await getDoc(id);
  if (!d || d.kind !== "consignment" || d.status !== "sent") return;
  const paidAt = today();
  await adminDb().from("documents").update({ status: "paid", paid_at: paidAt, updated_at: new Date().toISOString() }).eq("id", id);
  await markOwnersPaid(d, user, paidAt);
  await docEvent(d, `pagado al dueño (${usd(d.total)})`, user);
  refresh();
}

// Cotización aceptada o memo que el cliente se queda → factura con los mismos datos
export async function convertToInvoice(id: string) {
  const user = await requireAdmin();
  const d = await getDoc(id);
  if (!d || d.kind === "invoice" || d.kind === "consignment") return;
  const settings = await getDocSettings();
  const invoice = await insertDoc({
    kind: "invoice",
    customer_id: d.customer_id,
    client_name: d.client_name, client_company: d.client_company, client_email: d.client_email, client_phone: d.client_phone, client_address: d.client_address,
    lang: d.lang,
    issue_date: today(),
    due_date: today(),
    items: d.items,
    discount: d.discount,
    tax_rate: d.tax_rate,
    shipping: d.shipping,
    show_serial: true,
    notes: d.notes,
    terms: settings.doc_terms_invoice,
    payment_method: d.payment_method,
    source_id: d.id,
    created_by: user,
  });
  await adminDb().from("documents").update({ status: "converted", updated_at: new Date().toISOString() }).eq("id", id);
  await docEvent(d, `convertida en la factura ${invoice.number}`, user);
  await docEvent(invoice, `creada desde ${KIND_LABEL[d.kind].toLowerCase()} ${d.number}`, user);
  redirect(`/admin/documentos/${invoice.id}`);
}

export async function markPaid(id: string, _: unknown, f: FormData) {
  const user = await requireAdmin();
  const d = await getDoc(id);
  if (!d || d.kind !== "invoice" || d.status === "paid" || d.status === "void") return { error: "Esta factura no se puede marcar como pagada." };
  const method = text(f, "payment_method");
  const paidAt = date(f, "paid_at") ?? today();
  await adminDb().from("documents").update({ status: "paid", paid_at: paidAt, payment_method: method, updated_at: new Date().toISOString() }).eq("id", id);
  const paid = { ...d, status: "paid" as const, paid_at: paidAt, payment_method: method };
  await sellStock(paid, user);
  await docEvent(paid, `pagada (${usd(d.total)}${method ? ` · ${method}` : ""})`, user);
  if (d.customer_id) await adminDb().from("customers").update({ stage: "won", last_activity_at: new Date().toISOString() }).eq("id", d.customer_id);
  await notifyAdmins(`💰 <b>Factura pagada · ${h(d.number)}</b>\n${h(d.client_name ?? "Cliente")} · <b>${usd(d.total)}</b>${method ? ` · ${h(method)}` : ""}\n${h(d.items.map((l) => l.title).join(", "))}`).catch(() => {});
  refresh();
  return { ok: true };
}

export async function voidDocument(id: string) {
  const user = await requireAdmin();
  const d = await getDoc(id);
  if (!d || d.status === "paid") return;
  await adminDb().from("documents").update({ status: "void", updated_at: new Date().toISOString() }).eq("id", id);
  if (d.status === "sent" && (d.kind === "memo" || d.kind === "invoice")) await releaseStock(d, user, "documento anulado");
  await docEvent(d, "anulada", user);
  refresh();
}

export async function deleteDocument(id: string) {
  await requireAdmin();
  const d = await getDoc(id);
  if (d?.status !== "draft") return;
  await adminDb().from("documents").delete().eq("id", id);
  redirect("/admin/documentos");
}

export async function saveDocumentSettings(_: unknown, f: FormData) {
  await requireAdmin();
  await saveDocSettings(Object.fromEntries(DOC_SETTING_KEYS.map((k) => [k, String(f.get(k) ?? "").trim()])));
  refresh();
  return { ok: true };
}

