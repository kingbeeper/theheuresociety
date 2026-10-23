import "server-only";
import { adminDb } from "./supabase";
import { addEvent } from "./crm";

// Red de dealers: los clientes con la etiqueta «Dealer». Se les pide una pieza (de un encargo o una
// búsqueda suelta) por WhatsApp con el mensaje preparado, y se anota quién la tiene y a qué precio.

export type Dealer = { id: string; name: string | null; phone: string | null; wa_id: string | null; email: string | null };
export type DealerRequest = { id: string; document_id: string | null; query: string; budget: number | null; dealer_id: string; status: "asked" | "has" | "no" | "offered"; price: number | null; note: string | null; asked_at: string; answered_at: string | null };

export const REQUEST_STATUS: Record<DealerRequest["status"], string> = { asked: "Preguntado", has: "La tiene", offered: "Ofrece precio", no: "No la tiene" };

export async function dealers() {
  const { data } = await adminDb().from("customers").select("id, name, phone, wa_id, email, tags, notes").order("name");
  return ((data ?? []) as (Dealer & { tags: string[]; notes: string | null })[]).filter((c) => (c.tags ?? []).some((t) => t.toLowerCase() === "dealer"));
}

// Mensaje para el dealer (en inglés, como se habla en el gremio de Miami)
export function dealerMessage(query: string, budget: number | null, name: string | null) {
  return `Hi${name ? ` ${name.split(" ")[0]}` : ""}, The Heure Society here. I'm looking for: ${query}${budget ? ` — budget around $${Math.round(budget).toLocaleString("en-US")}` : ""}. Do you have one available or can you source it? Please send price, condition, year and box/papers. Thanks!`;
}

export const waLink = (d: Pick<Dealer, "wa_id" | "phone">, text: string) => {
  const n = d.wa_id ?? d.phone?.replace(/\D/g, "");
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : null;
};

// customerId: el cliente para quien se busca (su búsqueda «avísenme»); al responder «la tiene» llega aviso con él
export async function askDealers(query: string, budget: number | null, dealerIds: string[], documentId: string | null, user: string, customerId: string | null = null) {
  if (!dealerIds.length) return [];
  const db = adminDb();
  const { data } = await db
    .from("dealer_requests")
    .insert(dealerIds.map((dealer_id) => ({ document_id: documentId, query, budget, dealer_id, created_by: user, ...(customerId && { customer_id: customerId }) })))
    .select("id");
  for (const id of dealerIds) await addEvent(id, "dealer_request", `Se le pidió: ${query}${budget ? ` (presupuesto $${Math.round(budget).toLocaleString("en-US")})` : ""}`, { document: documentId }, user);
  return data ?? [];
}

export async function answerDealer(id: string, status: DealerRequest["status"], price: number | null, note: string | null, user: string) {
  const db = adminDb();
  const { data: r } = await db.from("dealer_requests").update({ status, price, note, answered_at: new Date().toISOString() }).eq("id", id).select("*").single();
  if (!r) return;
  await addEvent(r.dealer_id as string, "dealer_request", `Respuesta a «${r.query}»: ${REQUEST_STATUS[status]}${price ? ` · $${Math.round(price).toLocaleString("en-US")}` : ""}${note ? ` · ${note}` : ""}`, {}, user);
  // Era para un cliente: aviso con el cliente al lado y el margen si hay presupuesto
  if ((status === "has" || status === "offered") && r.customer_id) await dealerFoundForClient(r as DealerRequest & { customer_id: string }, user);
}

async function dealerFoundForClient(r: DealerRequest & { customer_id: string }, user: string) {
  const db = adminDb();
  const [{ data: c }, { data: d }] = await Promise.all([
    db.from("customers").select("id, name, phone").eq("id", r.customer_id).maybeSingle(),
    db.from("customers").select("name").eq("id", r.dealer_id).maybeSingle(),
  ]);
  if (!c) return;
  const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
  const price = r.price ? Number(r.price) : null;
  const budget = r.budget ? Number(r.budget) : null;
  const marginLine = price && budget ? (budget > price ? `Margen si se lo vendes a su presupuesto: ${usd(budget - price)} (${Math.round(((budget - price) / budget) * 100)}%)` : `⚠️ El dealer pide más que el presupuesto del cliente (${usd(budget)})`) : "";
  await addEvent(c.id, "dealer_request", `🤝 ${d?.name ?? "Un dealer"} tiene «${r.query}»${price ? ` a ${usd(price)}` : ""}`, { request: r.id }, user);
  const { notifyAdmins, escapeHtml: h } = await import("./telegram");
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://theheuresociety.vercel.app").replace(/\/$/, "");
  await notifyAdmins(
    [`🤝 <b>${h(d?.name ?? "Un dealer")} tiene lo que busca ${h(c.name ?? "tu cliente")}</b>`, `${h(r.query)}${price ? ` · <b>${usd(price)}</b>` : ""}${r.note ? ` · ${h(r.note)}` : ""}`, marginLine, `Ficha del cliente: ${site}/admin/leads/${c.id}`].filter(Boolean).join("\n")
  ).catch(() => {});
}

// Alta de un dealer (CRM o Telegram): si ya existe por teléfono o correo, solo se le pone la etiqueta
export async function addDealer(input: { name: string; phone?: string | null; email?: string | null; company?: string | null }, user: string) {
  const { upsertLead } = await import("./crm");
  const c = await upsertLead({ name: input.name, phone: input.phone || null, email: input.email || null, source: "other", stage: "won", notify: false });
  const tags = (c.tags ?? []) as string[];
  // Un dealer en la lista es un contacto ya ganado: sin etapa de venta
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), stage: "won" };
  const isNew = !tags.some((t) => t.toLowerCase() === "dealer");
  if (isNew) patch.tags = [...tags, "Dealer"];
  if (input.company && !(c.notes ?? "").includes(input.company)) patch.notes = c.notes ? `${c.notes}\nEmpresa: ${input.company}` : `Empresa: ${input.company}`;
  await adminDb().from("customers").update(patch).eq("id", c.id);
  if (isNew) await addEvent(c.id, "tag", "Añadida la etiqueta «Dealer»", {}, user);
  return c;
}

// Resumen de cada dealer: cuántas veces se le pidió, cuántas respondió, ofertas y la última vez
export type DealerStats = { asked: number; answered: number; has: number; best: DealerRequest | null; last: string | null };
export function statsFor(requests: DealerRequest[]): DealerStats {
  const answered = requests.filter((r) => r.status !== "asked");
  const has = requests.filter((r) => r.status === "has" || r.status === "offered");
  const priced = has.filter((r) => r.price).sort((a, b) => Number(a.price) - Number(b.price));
  return { asked: requests.length, answered: answered.length, has: has.length, best: priced[0] ?? null, last: requests[0]?.asked_at ?? null };
}

export async function requestsOf(dealerId: string, limit = 100) {
  const { data } = await adminDb().from("dealer_requests").select("*").eq("dealer_id", dealerId).order("asked_at", { ascending: false }).limit(limit);
  return (data ?? []) as DealerRequest[];
}

export { companyOf } from "./company";
