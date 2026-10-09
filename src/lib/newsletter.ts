import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { adminDb } from "./supabase";
import { addEvent } from "./crm";
import { contact } from "./site";

// Correos de novedades: los relojes recién publicados a los clientes con correo, filtrados por
// la marca que les interesa. Se envían con Resend (RESEND_API_KEY y EMAIL_FROM en el entorno).
// Cada correo lleva la dirección de la tienda y un enlace para darse de baja (CAN-SPAM).

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://theheuresociety.vercel.app").replace(/\/$/, "");
export const emailConfigured = () => Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);

export type NewsWatch = { id: string; slug: string; brand: string; model: string; reference: string; price: number | null; currency: string; image: string | null; published_at: string };
export type Recipient = { id: string; name: string | null; email: string; lang: string | null };

export async function recentWatches(days = 30) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data } = await adminDb()
    .from("watches")
    .select("id, slug, brand, model, reference, price, currency, images, published_at")
    .eq("status", "available")
    .gte("published_at", since)
    .order("published_at", { ascending: false });
  const abs = (u: string) => (u.startsWith("http") ? u : `${SITE}${u}`);
  return (data ?? []).map((w) => ({ ...w, image: ((w.images as string[]) ?? [])[0] ? abs((w.images as string[])[0]) : null })) as NewsWatch[];
}

// Clientes con correo que no se han dado de baja. Con marcas: solo a quien le interesan
// (por lo que busca, sus avisos o lo que ya compró).
export async function audience(brands: string[] | null) {
  const db = adminDb();
  const { data } = await db.from("customers").select("id, name, email, lang, interests").not("email", "is", null).eq("email_opt_out", false);
  let people = (data ?? []) as (Recipient & { interests: string | null })[];
  if (brands?.length) {
    const want = brands.map((b) => b.toLowerCase());
    const [{ data: alerts }, { data: bought }] = await Promise.all([
      db.from("watch_alerts").select("customer_id, query").eq("active", true),
      db.from("inventory_items").select("buyer_customer_id, brand").eq("status", "sold").not("buyer_customer_id", "is", null),
    ]);
    const likes = new Set<string>();
    for (const a of alerts ?? []) if (want.some((b) => String(a.query).toLowerCase().includes(b))) likes.add(a.customer_id as string);
    for (const s of bought ?? []) if (want.includes(String(s.brand).toLowerCase())) likes.add(s.buyer_customer_id as string);
    people = people.filter((p) => likes.has(p.id) || want.some((b) => (p.interests ?? "").toLowerCase().includes(b)));
  }
  return people.map(({ id, name, email, lang }) => ({ id, name, email, lang }));
}

// ── Baja ──
const secret = () => process.env.CRON_SECRET ?? "";
export const unsubscribeToken = (customerId: string) => createHmac("sha256", secret()).update(`unsub:${customerId}`).digest("hex").slice(0, 24);
export const unsubscribeUrl = (customerId: string) => `${SITE}/api/unsubscribe?c=${customerId}&t=${unsubscribeToken(customerId)}`;
export function validUnsubscribe(customerId: string, token: string) {
  const expected = unsubscribeToken(customerId);
  return Boolean(secret()) && token.length === expected.length && timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}

// ── Correo ──
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function buildEmail(watches: NewsWatch[], r: Pick<Recipient, "id" | "name" | "lang">, intro: string) {
  const es = r.lang === "es";
  const lang = es ? "es" : "en";
  const first = (r.name ?? "").split(" ")[0];
  const greeting = es ? `Estimado/a ${first || "cliente"},` : `Dear ${first || "client"},`;
  const price = (w: NewsWatch) => (w.price == null ? (es ? "Precio a consultar" : "Price on request") : `${w.currency === "USD" ? "$" : `${w.currency} `}${Number(w.price).toLocaleString("en-US")}`);
  const cards = watches
    .map(
      (w) => `
      <tr><td style="padding:0 0 28px">
        <a href="${SITE}/${lang}/watches/${w.slug}?utm_source=newsletter&utm_medium=email" style="text-decoration:none;color:#f1ece2">
          ${w.image ? `<img src="${esc(w.image)}" width="520" alt="${esc(`${w.brand} ${w.model}`)}" style="display:block;width:100%;max-width:520px;height:auto;border:0">` : ""}
          <p style="margin:14px 0 2px;font-family:Georgia,serif;font-size:22px;color:#f1ece2">${esc(w.brand)} ${esc(w.model)}</p>
          <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:12px;letter-spacing:1px;color:#a8b0a9">REF. ${esc(w.reference)} · ${esc(price(w))}</p>
        </a>
      </td></tr>`
    )
    .join("");
  const footer = es
    ? `Recibe este correo porque es cliente de The Heure Society. <a href="${unsubscribeUrl(r.id)}" style="color:#a8b0a9">Darse de baja</a>.`
    : `You're receiving this because you're a client of The Heure Society. <a href="${unsubscribeUrl(r.id)}" style="color:#a8b0a9">Unsubscribe</a>.`;
  const addr = `${contact.address.street}, ${contact.address.city}, ${contact.address.region} ${contact.address.postalCode}`;
  return `<!doctype html><html><body style="margin:0;background:#0b100d">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0b100d"><tr><td align="center" style="padding:36px 16px">
    <table width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%">
      <tr><td align="center" style="padding-bottom:28px">
        <img src="${SITE}/brand/wordmark-white.webp" width="220" alt="The Heure Society" style="display:block;width:220px;height:auto;border:0">
      </td></tr>
      <tr><td style="font-family:Georgia,serif;font-size:17px;line-height:1.6;color:#f1ece2;padding-bottom:6px">${esc(greeting)}</td></tr>
      <tr><td style="font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.7;color:#cfd4cf;padding-bottom:28px">${esc(intro).replace(/\n/g, "<br>")}</td></tr>
      ${cards}
      <tr><td align="center" style="padding:6px 0 30px">
        <a href="${SITE}/${lang}/watches?utm_source=newsletter&utm_medium=email" style="display:inline-block;border:1px solid #c8b07a;color:#c8b07a;padding:12px 26px;font-family:Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:3px;text-decoration:none">${es ? "VER LA COLECCIÓN" : "VIEW THE COLLECTION"}</a>
      </td></tr>
      <tr><td style="border-top:1px solid #2a3a31;padding-top:18px;font-family:Helvetica,Arial,sans-serif;font-size:11px;line-height:1.6;color:#7f8a82">
        The Heure Society · ${esc(addr)} · ${esc(contact.phoneDisplay)}<br>${footer}
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
}

export const defaultIntro = (es: boolean) =>
  es ? "Le compartimos las piezas que acaban de llegar a nuestra colección. Si alguna le interesa, responda a este correo o escríbanos por WhatsApp y se la reservamos." : "We'd like to share the pieces that have just arrived in our collection. If one catches your eye, simply reply to this email or message us on WhatsApp and we'll hold it for you.";

// Envío en lotes de 100 (API de Resend)
export async function sendNewsletter(watches: NewsWatch[], recipients: Recipient[], subject: { en: string; es: string }, intro: { en: string; es: string }, user: string) {
  if (!emailConfigured()) throw new Error("Falta configurar RESEND_API_KEY y EMAIL_FROM");
  let sent = 0;
  for (let i = 0; i < recipients.length; i += 100) {
    const batch = recipients.slice(i, i + 100).map((r) => {
      const es = r.lang === "es";
      return {
        from: process.env.EMAIL_FROM,
        to: [r.email],
        subject: es ? subject.es : subject.en,
        html: buildEmail(watches, r, es ? intro.es : intro.en),
        headers: { "List-Unsubscribe": `<${unsubscribeUrl(r.id)}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      };
    });
    const res = await fetch("https://api.resend.com/emails/batch", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(batch),
    });
    if (!res.ok) throw new Error(`Resend: ${res.status} ${await res.text()}`);
    sent += batch.length;
  }
  const label = watches.map((w) => `${w.brand} ${w.model}`).join(", ");
  for (const r of recipients) {
    if (!r.id.startsWith("prueba")) await addEvent(r.id, "newsletter", `Correo de novedades: ${label}`.slice(0, 300), {}, user);
  }
  return sent;
}
