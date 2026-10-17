import "server-only";
import { randomBytes } from "node:crypto";
import { adminDb } from "./supabase";

// Lista de precios para dealers (/p/<token>): el stock disponible a precio de dealer, en inglés (el idioma
// del gremio), sin costos, proveedores ni números de serie. Precio de dealer: el de la ficha o, si está
// vacío, el de venta menos el descuento general (Dealers → Mi lista de precios).

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://theheuresociety.vercel.app").replace(/\/$/, "");
const TOKEN_KEY = "dealer_pricelist_token";
const DISCOUNT_KEY = "dealer_discount";
export const DEFAULT_DISCOUNT = 10;

async function setting(key: string) {
  const { data } = await adminDb().from("integration_settings").select("value").eq("key", key).maybeSingle();
  return (data?.value as string | undefined) ?? null;
}
const save = (key: string, value: string) => adminDb().from("integration_settings").upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });

export async function dealerDiscount() {
  const v = Number(await setting(DISCOUNT_KEY));
  return Number.isFinite(v) && v >= 0 && v < 90 ? v : DEFAULT_DISCOUNT;
}
export const setDealerDiscount = (pct: number) => save(DISCOUNT_KEY, String(Math.max(0, Math.min(60, pct))));

// Enlace de la lista (se crea la primera vez; «renovar» invalida el anterior)
export async function pricelistToken(renew = false) {
  const current = renew ? null : await setting(TOKEN_KEY);
  if (current) return current;
  const token = randomBytes(18).toString("base64url");
  await save(TOKEN_KEY, token);
  return token;
}
export const pricelistUrl = (token: string) => `${SITE}/p/${token}`;
export async function validPricelist(token: string) {
  return Boolean(token) && (await setting(TOKEN_KEY)) === token;
}

export type DealerItem = { id: string; title: string; year: string | null; condition: string | null; set: string | null; price: number; retail: number | null; image: string | null; slug: string | null };

export async function dealerItems(): Promise<DealerItem[]> {
  const disc = await dealerDiscount();
  const { data } = await adminDb()
    .from("inventory_items")
    .select("id, brand, model, reference, papers_date, condition, comes_with, asking_price, dealer_price, watch:watches(slug, images, year)")
    .eq("status", "in_stock")
    .eq("category", "watch")
    .order("brand");
  type Row = { id: string; brand: string; model: string | null; reference: string | null; papers_date: string | null; condition: string | null; comes_with: string | null; asking_price: number | null; dealer_price: number | null; watch: { slug: string; images: string[]; year: number | null } | null };
  return ((data ?? []) as unknown as Row[])
    .map((i) => {
      const retail = i.asking_price ? Number(i.asking_price) : null;
      const price = i.dealer_price ? Number(i.dealer_price) : retail ? Math.round((retail * (1 - disc / 100)) / 50) * 50 : 0;
      return {
        id: i.id,
        title: [i.brand, i.model, i.reference].filter(Boolean).join(" "),
        year: i.papers_date?.slice(0, 4) ?? (i.watch?.year ? String(i.watch.year) : null),
        condition: i.condition,
        set: i.comes_with,
        price,
        retail,
        image: i.watch?.images?.[0] ?? null,
        slug: i.watch?.slug ?? null,
      };
    })
    .filter((i) => i.price > 0);
}

// Mensaje para enviar la lista a un dealer (en inglés)
export const pricelistMessage = (name: string | null, url: string) =>
  `Hi${name ? ` ${name.split(" ")[0]}` : ""}, The Heure Society here. Here's our current inventory at dealer prices: ${url}\nLet us know if anything works for you. Thanks!`;
