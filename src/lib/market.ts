import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { adminDb } from "./supabase";

// Precio de mercado de los relojes en stock, cada 5 días: Claude busca anuncios actuales (Chrono24 primero,
// WatchCharts y otros dealers) y guarda el rango en la ficha. La pasada de cada 10 minutos revisa un
// reloj cada vez, los que llevan más de 5 días sin revisar (si todos están al día, no hace nada); el resumen de los lunes compara con
// nuestro precio. Usa Sonnet (más barato) porque es un trabajo de fondo repetido.

const client = new Anthropic();
const MODEL = "claude-sonnet-5-5";
const SITES = ["chrono24.com", "watchcharts.com", "bobswatches.com", "watchfinder.com", "ebay.com"];
const EVERY = 5 * 86_400_000; // cada reloj se revisa una vez cada 5 días

const MarketSchema = z.object({
  low: z.number().nullable().describe("Precio pedido más bajo encontrado, USD"),
  typical: z.number().nullable().describe("Precio pedido típico (mediana aproximada), USD"),
  high: z.number().nullable().describe("Precio pedido más alto, USD"),
  listings: z.number().nullable().describe("Cuántos anuncios comparables se vieron"),
  note: z.string().describe("Una o dos frases en español: qué se comparó (estado, año, caja y papeles) y la tendencia si se ve"),
  sources: z.array(z.string()).describe("Hasta 3 enlaces de anuncios o páginas de precios"),
});
export type Market = z.infer<typeof MarketSchema>;

type Item = { id: string; sku: string; brand: string; model: string | null; reference: string | null; condition: string | null; comes_with: string | null; papers_date: string | null; asking_price: number | null };

async function research(i: Item) {
  const watch = [i.brand, i.model, i.reference].filter(Boolean).join(" ");
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `Busca el precio de mercado ACTUAL en USD de este reloj: ${watch}. Estado: ${i.condition ?? "pre-owned"}. Incluye: ${i.comes_with ?? "no consta"}${i.papers_date ? `, papeles de ${i.papers_date.slice(0, 7)}` : ""}.
Mira anuncios de Chrono24 (prioritario) y el precio de mercado de WatchCharts u otros dealers. Compara con piezas en estado y set parecidos (con o sin caja y papeles). Responde breve en español: precio pedido más bajo, típico y más alto, cuántos anuncios comparables viste y 2-3 enlaces. No inventes cifras.`,
    },
  ];
  for (let k = 0; k < 3; k++) {
    const res = await client.messages.create({ model: MODEL, max_tokens: 4000, tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 5, allowed_domains: SITES }], messages });
    if (res.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: res.content });
      continue;
    }
    return res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
  }
  return "";
}

export async function checkMarket(i: Item): Promise<Market | null> {
  const text = await research(i);
  if (!text) return null;
  const res = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 2000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { format: betaZodOutputFormat(MarketSchema) },
    messages: [{ role: "user", content: `Extrae los datos de este resumen de mercado de ${[i.brand, i.model, i.reference].filter(Boolean).join(" ")}. Si no hay cifras, deja los precios en null.\n\n${text}` }],
  });
  return res.parsed_output ?? null;
}

// Una pasada: el reloj en stock que lleva más tiempo sin revisar (si pasaron 5 días)
export async function marketPass() {
  const db = adminDb();
  const { data } = await db
    .from("inventory_items")
    .select("id, sku, brand, model, reference, condition, comes_with, papers_date, asking_price, market_checked_at")
    .in("status", ["in_stock", "reserved"])
    .eq("category", "watch") // el precio de mercado es solo para relojes
    .not("brand", "is", null)
    .or(`market_checked_at.is.null,market_checked_at.lt.${new Date(Date.now() - EVERY).toISOString()}`)
    .order("market_checked_at", { ascending: true, nullsFirst: true })
    .limit(1);
  const i = data?.[0] as Item | undefined;
  if (!i || (!i.reference && !i.model)) return null;
  // Se marca antes de buscar: si la búsqueda falla, no se reintenta en bucle cada 10 minutos
  await db.from("inventory_items").update({ market_checked_at: new Date().toISOString() }).eq("id", i.id);
  const m = await checkMarket(i).catch(() => null);
  if (m) {
    await db
      .from("inventory_items")
      .update({ market_low: m.low, market_typical: m.typical, market_high: m.high, market_listings: m.listings, market_note: m.note, market_sources: m.sources.slice(0, 3) })
      .eq("id", i.id);
  }
  return i.sku;
}

// Nuestro precio frente al mercado: «alto» si supera el más alto, «bajo» si queda por debajo del más bajo
export function priceVsMarket(i: { asking_price: number | null; market_low: number | null; market_high: number | null; market_typical: number | null }) {
  const p = Number(i.asking_price ?? 0);
  if (!p || (!i.market_low && !i.market_high)) return null;
  if (i.market_high && p > Number(i.market_high) * 1.03) return { state: "high" as const, diff: p - Number(i.market_typical ?? i.market_high) };
  if (i.market_low && p < Number(i.market_low) * 0.97) return { state: "low" as const, diff: Number(i.market_typical ?? i.market_low) - p };
  return { state: "ok" as const, diff: 0 };
}
