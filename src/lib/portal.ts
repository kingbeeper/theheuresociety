import "server-only";
import { randomBytes } from "node:crypto";
import { adminDb } from "./supabase";

// Portal privado «Mi colección» de cada cliente (/c/<token>): lo que nos compró con sus facturas y
// certificados, cuándo le toca el servicio, sus documentos abiertos, sus búsquedas, los relojes que nos
// dejó en consignación y piezas que le pueden gustar. Nunca costos, proveedores ni notas internas.

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://theheuresociety.vercel.app").replace(/\/$/, "");
export const SERVICE_YEARS = 5;

export const portalUrl = (token: string) => `${SITE}/c/${token}`;

// Enlace del cliente (se crea la primera vez; «nuevo» lo cambia y el anterior deja de funcionar)
export async function portalToken(customerId: string, renew = false) {
  const db = adminDb();
  if (!renew) {
    const { data } = await db.from("customers").select("portal_token").eq("id", customerId).maybeSingle();
    if (data?.portal_token) return data.portal_token as string;
  }
  const token = randomBytes(18).toString("base64url");
  const { error } = await db.from("customers").update({ portal_token: token }).eq("id", customerId);
  if (error) throw error;
  return token;
}

export async function portalData(token: string) {
  const db = adminDb();
  const { data: c } = await db.from("customers").select("id, name, lang").eq("portal_token", token).maybeSingle();
  if (!c) return null;
  const [bought, consigned, docs, alerts] = await Promise.all([
    db.from("inventory_items").select("id, brand, model, reference, sale_date, papers_date, watch:watches(slug, images)").eq("buyer_customer_id", c.id).eq("status", "sold").order("sale_date", { ascending: false }),
    db.from("inventory_items").select("id, brand, model, reference, status, acquisition, watch:watches(slug, status, images)").eq("supplier_customer_id", c.id).in("acquisition", ["consignment", "memo"]).order("created_at", { ascending: false }),
    db.from("documents").select("id, kind, number, status, token, items, issue_date, total").eq("customer_id", c.id).neq("status", "draft").neq("status", "void").order("issue_date", { ascending: false }).limit(40),
    db.from("watch_alerts").select("query, created_at").eq("customer_id", c.id).eq("active", true),
  ]);
  type W = { slug: string; images: string[]; status?: string } | null;
  const documents = (docs.data ?? []) as { id: string; kind: string; number: string; status: string; token: string; items: { item_id?: string | null }[]; issue_date: string; total: number }[];
  // Factura (y certificado) de cada reloj comprado
  const invoiceFor = (itemId: string) => documents.find((d) => d.kind === "invoice" && d.status === "paid" && d.items?.some((l) => l.item_id === itemId));
  const purchases = ((bought.data ?? []) as unknown as { id: string; brand: string; model: string | null; reference: string | null; sale_date: string | null; papers_date: string | null; watch: W }[]).map((i) => {
    const since = i.papers_date ?? i.sale_date;
    const inv = invoiceFor(i.id);
    return {
      id: i.id,
      title: [i.brand, i.model, i.reference].filter(Boolean).join(" "),
      date: i.sale_date,
      image: i.watch?.images?.[0] ?? null,
      invoice: inv ? `${SITE}/d/${inv.token}` : null,
      certificate: inv ? `${SITE}/d/${inv.token}/certificate` : null,
      service: since ? String(Number(since.slice(0, 4)) + SERVICE_YEARS) : null,
    };
  });
  const consignments = ((consigned.data ?? []) as unknown as { id: string; brand: string; model: string | null; reference: string | null; status: string; acquisition: string; watch: W }[]).map((i) => ({
    id: i.id,
    title: [i.brand, i.model, i.reference].filter(Boolean).join(" "),
    status: i.status,
    listing: i.watch?.slug && ["available", "reserved"].includes(i.watch.status ?? "") ? i.watch.slug : null,
    image: i.watch?.images?.[0] ?? null,
  }));
  // Documentos que aún piden algo (firmar, pagar) o de consulta, sin las facturas ya enlazadas arriba
  const linked = new Set(purchases.map((p) => p.invoice));
  const openDocs = documents.filter((d) => !linked.has(`${SITE}/d/${d.token}`)).slice(0, 12).map((d) => ({ kind: d.kind, number: d.number, status: d.status, url: `${SITE}/d/${d.token}`, date: d.issue_date }));
  // Sugerencias: piezas disponibles de las marcas que le gustan
  const brands = [...new Set([...purchases.map((p) => p.title.split(" ")[0]), ...(alerts.data ?? []).map((a) => String(a.query).split(" ")[0])].map((b) => b.toLowerCase()))];
  const { data: avail } = await db.from("watches").select("slug, brand, model, reference, price, currency, images").eq("status", "available").order("published_at", { ascending: false }).limit(60);
  const suggestions = (avail ?? []).filter((w) => !brands.length || brands.includes(String(w.brand).toLowerCase())).slice(0, 4);
  return {
    name: (c.name as string | null) ?? "",
    lang: (c.lang === "es" ? "es" : "en") as "es" | "en",
    purchases,
    consignments,
    openDocs,
    searches: (alerts.data ?? []).map((a) => a.query as string),
    suggestions: (suggestions.length ? suggestions : (avail ?? []).slice(0, 4)) as { slug: string; brand: string; model: string; reference: string; price: number | null; currency: string; images: string[] }[],
  };
}
