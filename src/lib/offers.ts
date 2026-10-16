import "server-only";
import { adminDb, PHOTO_BUCKET } from "./supabase";
import { upsertLead } from "./crm";

// Ofertas de clientes (tabla sell_requests): relojes que nos ofrecen para comprar, intercambiar o consignar.
// Llegan solas de la web, WhatsApp e Instagram/Facebook; esto es para registrarlas a mano (CRM o Telegram).

export const OFFER_KIND = { sell: "Venta", trade: "Intercambio", consign: "Consignación" } as const;
export type OfferKind = keyof typeof OFFER_KIND;

export type OfferInput = {
  kind: OfferKind;
  name: string;
  phone?: string | null;
  email?: string | null;
  brand: string;
  model?: string | null;
  reference?: string | null;
  asking?: string | null; // lo que pide el cliente (texto libre: «18k», «$18,000»)
  details?: string | null;
  photos?: { type: string }[];
};

export async function createOffer(o: OfferInput, user: string, source = "walk_in") {
  const db = adminDb();
  const watch = [o.brand, o.model, o.reference].map((x) => x?.trim()).filter(Boolean).join(" ");
  const customer = await upsertLead({
    name: o.name.trim(),
    phone: o.phone?.trim() || null,
    email: o.email?.trim() || null,
    source,
    intent: o.kind,
    stage: "qualified",
    notify: false,
    event: { type: "sell_request", body: `${{ sell: "Vende", trade: "Intercambia", consign: "Consigna" }[o.kind]}: ${watch}` },
  });
  const id = crypto.randomUUID();
  const bucket = db.storage.from(PHOTO_BUCKET);
  const uploads = (
    await Promise.all(
      (o.photos ?? []).slice(0, 10).map(async (p, i) => {
        const ext = p.type.includes("png") ? "png" : p.type.includes("webp") ? "webp" : "jpg";
        const path = `leads/${id}/${i + 1}.${ext}`;
        const { data } = await bucket.createSignedUploadUrl(path);
        return data ? { url: data.signedUrl, publicUrl: bucket.getPublicUrl(path).data.publicUrl } : null;
      })
    )
  ).filter((u): u is NonNullable<typeof u> => Boolean(u));
  const message = [o.asking?.trim() && `Pide: ${o.asking.trim()}`, o.details?.trim()].filter(Boolean).join("\n") || null;
  const { error } = await db.from("sell_requests").insert({
    id,
    kind: o.kind,
    name: o.name.trim(),
    phone: customer.phone,
    email: customer.email,
    brand: o.brand.trim(),
    model: o.model?.trim() || null,
    reference: o.reference?.trim() || null,
    message,
    image_paths: [],
    customer_id: customer.id,
    notes: `Registrada a mano por ${user}`,
  });
  if (error) return { error: error.message };
  return { ok: true as const, id, customerId: customer.id, uploads };
}

// Tasar la oferta: el mismo estudio de mercado que el inventario (Chrono24, WatchCharts…), guardado en la oferta
export async function appraiseOffer(id: string) {
  const db = adminDb();
  const { data: r } = await db.from("sell_requests").select("id, brand, model, reference, message").eq("id", id).single();
  if (!r) return null;
  const { checkMarket } = await import("./market");
  const m = await checkMarket({ id: r.id, sku: "", brand: r.brand, model: r.model, reference: r.reference, condition: null, comes_with: r.message, papers_date: null, asking_price: null }).catch(() => null);
  await db
    .from("sell_requests")
    .update({ market_checked_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...(m && { market_low: m.low, market_typical: m.typical, market_high: m.high, market_listings: m.listings, market_note: m.note, market_sources: m.sources.slice(0, 3) }) })
    .eq("id", id);
  return m;
}

// Lo que pide el cliente, sacado del texto «Pide: $14,000» / «Price: 14k» de la oferta
export function askingOf(message: string | null | undefined) {
  const m = message?.match(/(?:pide|price|precio|asking)[^:\n]*:\s*\$?\s*([\d.,]+)\s*(k)?/i);
  if (!m) return null;
  const n = Number(m[2] ? m[1].replace(",", ".") : m[1].replace(/[.,](?=\d{3}\b)/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.round(m[2] ? n * 1000 : n) : null;
}

// Cuánto ofrecer: para comprar o cambiar, el precio típico de mercado menos el margen; en consignación,
// a qué precio venderlo y cuánto quedaría para el dueño con nuestra comisión.
export const MARGINS = [0.12, 0.15, 0.2];
export const CONSIGN_COMMISSION = 0.15;
export function offerSuggestion(kind: string, typical: number | null) {
  if (!typical) return null;
  const r = (n: number) => Math.round(n / 50) * 50;
  if (kind === "consign") return { kind: "consign" as const, sellAt: r(typical), owner: r(typical * (1 - CONSIGN_COMMISSION)) };
  return { kind: "buy" as const, offers: MARGINS.map((m) => ({ margin: m, amount: r(typical * (1 - m)) })) };
}

// Mensaje de WhatsApp con nuestra propuesta (en el idioma del cliente). En consignación, «amount» es lo
// que recibiría el dueño (neto) y «sellAt» el precio al que lo pondríamos a la venta.
export function offerMessage(r: { kind: string; name: string | null; brand: string; model?: string | null; reference?: string | null }, amount: number, lang: "es" | "en", sellAt?: number | null) {
  const first = (r.name ?? "").split(" ")[0];
  const watch = [r.brand, r.model, r.reference].filter(Boolean).join(" ");
  const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
  if (lang === "es") {
    const body =
      r.kind === "consign"
        ? `le proponemos ponerlo a la venta${sellAt ? ` por ${usd(sellAt)}` : ""}; al venderse usted recibiría ${usd(amount)} netos, en un máximo de 5 días hábiles.`
        : r.kind === "trade"
        ? `le podemos reconocer ${usd(amount)} por él como parte de pago de otro reloj de nuestra colección.`
        : `le podemos ofrecer ${usd(amount)} por él, con pago por transferencia en cuanto lo recibamos y verifiquemos.`;
    return `Hola ${first}, gracias por pensar en The Heure Society para su ${watch}. Después de revisar el mercado, ${body}\n¿Le parece bien? Si quiere, coordinamos para verlo en nuestra oficina de Miami.`;
  }
  const body =
    r.kind === "consign"
      ? `we'd suggest listing it${sellAt ? ` at ${usd(sellAt)}` : ""}; once it sells you would receive ${usd(amount)} net, within 5 business days.`
      : r.kind === "trade"
      ? `we can offer you a ${usd(amount)} trade-in credit toward another timepiece from our collection.`
      : `we can offer you ${usd(amount)} for it, paid by wire as soon as we receive and authenticate it.`;
  return `Hi ${first}, thank you for thinking of The Heure Society for your ${watch}. After reviewing the market, ${body}\nDoes that work for you? We're happy to arrange a viewing at our Miami office.`;
}

// Registra la oferta enviada: importe, etapa «Ofertada» y nota en la ficha. Devuelve el enlace de WhatsApp.
export async function sendOffer(id: string, amount: number, lang: "es" | "en" | null, user: string) {
  const db = adminDb();
  const { data: r } = await db.from("sell_requests").select("id, kind, name, phone, brand, model, reference, status, customer_id, market_typical").eq("id", id).single();
  if (!r) return null;
  const { data: c } = r.customer_id ? await db.from("customers").select("lang, phone, wa_id").eq("id", r.customer_id).maybeSingle() : { data: null };
  const l = lang ?? (c?.lang === "es" ? "es" : c?.lang === "en" ? "en" : "es");
  const sellAt = r.kind === "consign" && r.market_typical ? Math.round(Number(r.market_typical) / 50) * 50 : null;
  const text = offerMessage(r, amount, l, sellAt);
  await db.from("sell_requests").update({ offer_amount: amount, ...(["new"].includes(r.status ?? "new") && { status: "offered" }), updated_at: new Date().toISOString() }).eq("id", id);
  if (r.customer_id) {
    const { addEvent } = await import("./crm");
    await addEvent(r.customer_id, "sell_request", `Oferta enviada por WhatsApp: ${[r.brand, r.model].filter(Boolean).join(" ")} · $${Math.round(amount).toLocaleString("en-US")}${r.kind === "consign" ? " neto al dueño" : ""}`, { request: id }, user);
  }
  const phone = (c?.wa_id ?? c?.phone ?? r.phone ?? "").replace(/\D/g, "");
  return { text, wa: phone ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}` : null };
}
