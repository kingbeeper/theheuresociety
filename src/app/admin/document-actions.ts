"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { adminDb } from "@/lib/supabase";
import { upsertLead } from "@/lib/crm";
import { closeReturned, consignorPaid, docEvent, getDoc, insertDoc, issueDoc, payInvoice, reserveStock, saveDocSettings, toInvoice, voidDoc } from "@/lib/documents";
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
  const user = await requireAdmin("documentos");
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
    due_date: kind === "purchase" ? null : date(f, "due_date"),
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
  await closeReturned(d, user);
  refresh();
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
  if (!d || d.kind === "invoice" || d.kind === "consignment" || d.kind === "purchase") return;
  const invoice = await toInvoice(d, user);
  redirect(`/admin/documentos/${invoice.id}`);
}

export async function markPaid(id: string, _: unknown, f: FormData) {
  const user = await requireAdmin("documentos");
  const d = await getDoc(id);
  if (!d || d.kind !== "invoice" || d.status === "paid" || d.status === "void") return { error: "Esta factura no se puede marcar como pagada." };
  await payInvoice(d, text(f, "payment_method"), date(f, "paid_at") ?? today(), user);
  refresh();
  return { ok: true };
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

