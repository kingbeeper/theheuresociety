import "server-only";
import { adminDb } from "./supabase";
import { addEvent } from "./crm";
import { logItem, syncWebStatus } from "./stock";
import { getDoc, payInvoice } from "./documents";
import { createCheckout } from "./stripe";
import { escapeHtml as h, notifyAdmins } from "./telegram";
import type { Doc } from "./doc-labels";

// Pagos con tarjeta: depósito para reservar un reloj, o una factura completa desde su enlace.
// Al confirmarse el pago (webhook de Stripe) se reserva el reloj o se marca la factura pagada.

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://theheuresociety.vercel.app").replace(/\/$/, "");
const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function openPayment(row: Record<string, unknown>, checkout: Omit<Parameters<typeof createCheckout>[0], "metadata">) {
  const db = adminDb();
  const { data: p, error } = await db.from("payments").insert(row).select("id").single();
  if (error) throw error;
  const s = await createCheckout({ ...checkout, metadata: { payment_id: p.id } });
  await db.from("payments").update({ stripe_session_id: s.id, url: s.url }).eq("id", p.id);
  return s.url;
}

export async function depositLink(itemId: string, amount: number, customerId: string | null, user: string) {
  const db = adminDb();
  const { data: i } = await db.from("inventory_items").select("sku, brand, model, reference").eq("id", itemId).single();
  if (!i) throw new Error("Reloj no encontrado");
  const { data: c } = customerId ? await db.from("customers").select("email").eq("id", customerId).single() : { data: null };
  return openPayment(
    { kind: "deposit", item_id: itemId, customer_id: customerId, amount, created_by: user },
    {
      amount,
      name: `Deposit · ${i.brand} ${i.model ?? ""} ${i.reference ?? ""}`.replace(/\s+/g, " ").trim(),
      description: "Reservation deposit · The Heure Society",
      email: c?.email ?? null,
      successUrl: `${SITE}/d/gracias`,
      cancelUrl: `${SITE}/d/gracias?cancelado=1`,
    }
  );
}

export async function invoiceLink(d: Doc) {
  return openPayment(
    { kind: "invoice", document_id: d.id, customer_id: d.customer_id, amount: d.total, created_by: "cliente" },
    {
      amount: Number(d.total),
      name: `Invoice ${d.number} · The Heure Society`,
      description: d.items.map((l) => l.title).join(", "),
      email: d.client_email,
      successUrl: `${SITE}/d/${d.token}?pagado=1`,
      cancelUrl: `${SITE}/d/${d.token}`,
    }
  );
}

// Pago confirmado por Stripe (puede llegar más de una vez: solo actúa la primera)
export async function paymentCompleted(paymentId: string) {
  const db = adminDb();
  const { data: p } = await db.from("payments").update({ status: "paid", paid_at: new Date().toISOString() }).eq("id", paymentId).eq("status", "open").select("*").maybeSingle();
  if (!p) return;
  const amount = Number(p.amount);

  if (p.kind === "invoice" && p.document_id) {
    const d = await getDoc(p.document_id);
    if (d && d.status === "sent") await payInvoice(d, "Tarjeta (Stripe)", new Date().toISOString().slice(0, 10), "stripe");
    return;
  }

  // Depósito: el reloj queda reservado (también en la web)
  if (p.item_id) {
    const { data: i } = await db.from("inventory_items").select("id, sku, brand, model, status, watch_id").eq("id", p.item_id).single();
    if (i && i.status === "in_stock") {
      await db.from("inventory_items").update({ status: "reserved", updated_at: new Date().toISOString() }).eq("id", i.id);
      await syncWebStatus(i.watch_id, "reserved");
    }
    if (i) await logItem(i.id, "status", `Depósito de ${usd(amount)} pagado con tarjeta: reservado`, "stripe");
    if (p.customer_id) await addEvent(p.customer_id, "purchase", `Pagó un depósito de ${usd(amount)} para reservar ${i?.brand ?? ""} ${i?.model ?? ""}`.trim(), { payment: p.id }, "stripe");
    await notifyAdmins(`💳 <b>Depósito recibido</b>: ${usd(amount)}\n${h(i?.sku ?? "")} ${h(i?.brand ?? "")} ${h(i?.model ?? "")} queda <b>reservado</b>.`).catch(() => {});
  }
}
