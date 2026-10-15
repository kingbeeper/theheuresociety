import "server-only";
import { adminDb } from "./supabase";
import { addEvent } from "./crm";

// Red de dealers: los clientes con la etiqueta «Dealer». Se les pide una pieza (de un encargo o una
// búsqueda suelta) por WhatsApp con el mensaje preparado, y se anota quién la tiene y a qué precio.

export type Dealer = { id: string; name: string | null; phone: string | null; wa_id: string | null; email: string | null };
export type DealerRequest = { id: string; document_id: string | null; query: string; budget: number | null; dealer_id: string; status: "asked" | "has" | "no" | "offered"; price: number | null; note: string | null; asked_at: string; answered_at: string | null };

export const REQUEST_STATUS: Record<DealerRequest["status"], string> = { asked: "Preguntado", has: "La tiene", offered: "Ofrece precio", no: "No la tiene" };

export async function dealers() {
  const { data } = await adminDb().from("customers").select("id, name, phone, wa_id, email, tags").order("name");
  return ((data ?? []) as (Dealer & { tags: string[] })[]).filter((c) => (c.tags ?? []).some((t) => t.toLowerCase() === "dealer"));
}

// Mensaje para el dealer (en inglés, como se habla en el gremio de Miami)
export function dealerMessage(query: string, budget: number | null, name: string | null) {
  return `Hi${name ? ` ${name.split(" ")[0]}` : ""}, The Heure Society here. I'm looking for: ${query}${budget ? ` — budget around $${Math.round(budget).toLocaleString("en-US")}` : ""}. Do you have one available or can you source it? Please send price, condition, year and box/papers. Thanks!`;
}

export const waLink = (d: Pick<Dealer, "wa_id" | "phone">, text: string) => {
  const n = d.wa_id ?? d.phone?.replace(/\D/g, "");
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : null;
};

export async function askDealers(query: string, budget: number | null, dealerIds: string[], documentId: string | null, user: string) {
  if (!dealerIds.length) return [];
  const db = adminDb();
  const { data } = await db
    .from("dealer_requests")
    .insert(dealerIds.map((dealer_id) => ({ document_id: documentId, query, budget, dealer_id, created_by: user })))
    .select("id");
  for (const id of dealerIds) await addEvent(id, "dealer_request", `Se le pidió: ${query}${budget ? ` (presupuesto $${Math.round(budget).toLocaleString("en-US")})` : ""}`, { document: documentId }, user);
  return data ?? [];
}

export async function answerDealer(id: string, status: DealerRequest["status"], price: number | null, note: string | null, user: string) {
  const db = adminDb();
  const { data: r } = await db.from("dealer_requests").update({ status, price, note, answered_at: new Date().toISOString() }).eq("id", id).select("dealer_id, query").single();
  if (r) await addEvent(r.dealer_id as string, "dealer_request", `Respuesta a «${r.query}»: ${REQUEST_STATUS[status]}${price ? ` · $${Math.round(price).toLocaleString("en-US")}` : ""}${note ? ` · ${note}` : ""}`, {}, user);
}
