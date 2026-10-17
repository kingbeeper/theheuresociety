import "server-only";
import { adminDb } from "./supabase";

// Precio del oro (y plata y platino) del día, de gold-api.com (gratis, sin clave), guardado una hora.
// Sirve para el valor del metal de cadenas y joyas de oro por su peso y quilates, como referencia para
// comprar o tasar, y para avisar si el oro se mueve mucho de un día para otro.

const KEY = "metal_prices";
const OZ = 31.1034768; // gramos por onza troy
export type Metal = "gold" | "silver" | "platinum";
export type Prices = { gold: number; silver: number | null; platinum: number | null; at: string; prevGold: number | null; prevAt: string | null };

async function fetchSpot(symbol: "XAU" | "XAG" | "XPT") {
  const res = await fetch(`https://api.gold-api.com/price/${symbol}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`gold-api ${res.status}`);
  const j = (await res.json()) as { price?: number };
  if (!j.price || !Number.isFinite(j.price)) throw new Error("Precio no válido");
  return j.price;
}

// Precios por onza (USD), refrescados como mucho cada hora; guarda el del día anterior para comparar
export async function metalPrices(maxAgeMin = 60): Promise<Prices | null> {
  const db = adminDb();
  const { data } = await db.from("integration_settings").select("value").eq("key", KEY).maybeSingle();
  let saved: Prices | null = null;
  try {
    saved = data ? (JSON.parse(data.value as string) as Prices) : null;
  } catch {}
  if (saved && Date.now() - Date.parse(saved.at) < maxAgeMin * 60_000) return saved;
  try {
    const [gold, silver, platinum] = await Promise.all([fetchSpot("XAU"), fetchSpot("XAG").catch(() => null), fetchSpot("XPT").catch(() => null)]);
    const day = (iso: string) => iso.slice(0, 10);
    const now = new Date().toISOString();
    // El «anterior» es el último precio de un día distinto a hoy
    const prev = saved && day(saved.at) !== day(now) ? { gold: saved.gold, at: saved.at } : saved ? { gold: saved.prevGold, at: saved.prevAt } : { gold: null, at: null };
    const next: Prices = { gold, silver, platinum, at: now, prevGold: prev.gold ?? null, prevAt: prev.at ?? null };
    await db.from("integration_settings").upsert({ key: KEY, value: JSON.stringify(next), updated_at: now }, { onConflict: "key" });
    return next;
  } catch (e) {
    console.error("Precio del oro:", e);
    return saved;
  }
}

// Pureza a partir del texto del metal: «Oro 14k» → oro 0.585; «Plata 925» → plata 0.925; «Platino» → 0.95
export function purity(metal: string | null | undefined): { metal: Metal; fine: number; label: string } | null {
  const m = (metal ?? "").toLowerCase();
  const k = m.match(/(\d{1,2})\s*k/);
  if (/oro|gold/.test(m) || k) {
    const karat = k ? Number(k[1]) : 18;
    return { metal: "gold", fine: Math.min(24, karat) / 24, label: `${karat}k` };
  }
  if (/plat(a|ino)?\s*925|sterling|silver|plata/.test(m) && !/platino|platinum/.test(m)) return { metal: "silver", fine: 0.925, label: "925" };
  if (/platino|platinum|pt/.test(m)) return { metal: "platinum", fine: 0.95, label: "Pt950" };
  return null;
}

export const perGram = (prices: Prices, metal: Metal) => {
  const oz = metal === "gold" ? prices.gold : metal === "silver" ? prices.silver : prices.platinum;
  return oz ? oz / OZ : null;
};

// Valor del metal de una pieza: peso (g) × pureza × precio del gramo puro
export function meltValue(prices: Prices, metal: string | null | undefined, weightG: number | string | null | undefined) {
  const p = purity(metal);
  const w = Number(String(weightG ?? "").replace(",", "."));
  if (!p || !Number.isFinite(w) || w <= 0) return null;
  const g = perGram(prices, p.metal);
  return g ? { value: w * p.fine * g, label: p.label, metal: p.metal, weight: w } : null;
}

export const KARATS = [10, 14, 18, 22, 24];

// Cambio del oro frente al día anterior (en %), o null
export function goldChange(p: Prices) {
  return p.prevGold ? ((p.gold - p.prevGold) / p.prevGold) * 100 : null;
}
