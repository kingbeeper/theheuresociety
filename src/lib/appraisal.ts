import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { adminDb } from "./supabase";

// Tasación rápida por foto, de uno o varios relojes (p. ej. dos piezas que ofrecen juntas por 99k).
// 1. Mercado: identifica cada reloj y busca precios pedidos actuales (Chrono24, WatchCharts…) con
//    la búsqueda web de Claude. 2. Tasación: con el mercado, NUESTRAS compras y ventas y las fotos,
//    sugiere un rango de oferta por reloj y en total. Es orientativa: decide siempre el dueño.

const WatchSchema = z.object({
  brand: z.string(),
  model: z.string(),
  reference: z.string().nullable(),
  confidence: z.enum(["high", "medium", "low"]),
  observations: z.array(z.string()).describe("Lo que se ve en las fotos: estado, detalles, posibles problemas"),
  market_summary: z.string().describe("Qué dicen los anuncios actuales encontrados (rango de precios pedidos y cuántos)"),
  market_low: z.number().nullable().describe("Precio pedido más bajo razonable en el mercado actual (USD)"),
  market_high: z.number().nullable(),
  our_data: z.string().describe("Qué dicen nuestras compras y ventas de piezas parecidas, o que no hay"),
  offer_low: z.number().nullable(),
  offer_high: z.number().nullable(),
  expected_sale: z.number().nullable(),
});

const AppraisalSchema = z.object({
  watches: z.array(WatchSchema).describe("Un elemento por cada reloj ofrecido"),
  asked_total: z.number().nullable().describe("Lo que pide el cliente por todo, si la nota lo dice (USD)"),
  total_offer_low: z.number().nullable(),
  total_offer_high: z.number().nullable(),
  verdict: z.string().describe("Una o dos frases: ¿el precio pedido es razonable?, qué contraofertar"),
  basis: z.enum(["market_and_our_data", "market", "our_data", "general_estimate", "insufficient"]),
  warnings: z.array(z.string()),
  sources: z.array(z.string()).describe("Enlaces de los anuncios o páginas consultadas (máx. 6)"),
});
export type Appraisal = z.infer<typeof AppraisalSchema>;

const client = new Anthropic();
const MARKET_SITES = ["chrono24.com", "watchcharts.com", "bobswatches.com", "watchfinder.com", "ebay.com"];

const userContent = (photoUrls: string[], text: string): Anthropic.ContentBlockParam[] => [
  ...photoUrls.map((url) => ({ type: "image" as const, source: { type: "url" as const, url } })),
  { type: "text" as const, text },
];

// 1. Mercado: búsqueda web de los precios actuales de cada reloj (texto con cifras y enlaces)
async function marketResearch(photoUrls: string[], note: string) {
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: userContent(
        photoUrls,
        `Nota del dueño de The Heure Society (dealer de relojes en Miami): ${note || "(sin nota)"}

Identifica cada reloj que se ofrece (por la nota y las fotos; puede haber uno o varios, en fotos separadas o juntos en una). Para cada uno, busca en la web el precio de mercado ACTUAL en USD: anuncios de Chrono24 (prioritario) y el precio de mercado de WatchCharts u otros dealers. Prefiere anuncios con el mismo estado y con caja y papeles si el reloj los trae.

Responde en español, breve, por reloj: marca, modelo y referencia; rango de precios pedidos que encontraste (más bajo, típico y más alto), cuántos anuncios viste y 2-3 enlaces. No inventes cifras: si no encuentras datos de una referencia, dilo.`
      ),
    },
  ];
  // La búsqueda puede pausar el turno (pause_turn): se reanuda hasta 3 veces
  for (let i = 0; i < 4; i++) {
    const res = await client.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 8000,
      output_config: { effort: "medium" },
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 8, allowed_domains: MARKET_SITES }],
      messages,
    });
    if (res.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: res.content });
      continue;
    }
    if (res.stop_reason === "refusal") return "";
    return res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
  }
  return "";
}

const SYSTEM = `Eres el especialista en compras de The Heure Society, un dealer de relojes de lujo de segunda mano en Miami. El dueño te envía fotos de uno o varios relojes que le ofrecen, una nota (referencias, estado, caja y papeles, lo que pide el vendedor, a veces un precio por el lote) y un resumen del mercado actual buscado en la web.

Para CADA reloj:
1. Identifica marca, modelo y referencia (la nota manda; las fotos confirman). Si no estás seguro, dilo y baja "confidence".
2. Describe lo que ves (cristal, bisel, brazalete, pulido, esfera…). No des por hecho lo que no se ve.
3. Usa el resumen de mercado (precios pedidos actuales) y NUESTROS datos (costos, precios y ventas reales) para sugerir un rango de oferta y un precio de venta esperado. Un dealer compra con margen: la oferta suele quedar por debajo de los precios pedidos (los pedidos no son precios de venta), según rotación, estado y si trae caja y papeles.
Después, el total: suma los rangos, compara con lo que pide el cliente ("asked_total") y en "verdict" di si es razonable y qué contraoferta harías.
Importes en dólares, redondeados a 50. Todo en español. Nunca afirmes que un reloj es auténtico solo por fotos. "sources": los enlaces del resumen de mercado.`;

async function ourData() {
  const { data } = await adminDb()
    .from("inventory_items")
    .select("sku, status, acquisition, brand, model, reference, papers_date, condition, comes_with, purchase_date, cost, extra_costs, asking_price, sale_date, sale_price")
    .order("purchase_date", { ascending: false })
    .limit(400);
  return (data ?? []).map((i) => ({
    sku: i.sku, status: i.status, acquisition: i.acquisition, watch: [i.brand, i.model, i.reference].filter(Boolean).join(" "),
    papers: i.papers_date, condition: i.condition, set: i.comes_with, bought: i.purchase_date, cost: i.cost, extra: i.extra_costs,
    asking: i.asking_price, sold: i.sale_date, sale: i.sale_price,
  }));
}

export async function appraise(photoUrls: string[], note: string): Promise<Appraisal> {
  const [market, data] = await Promise.all([marketResearch(photoUrls, note).catch(() => ""), ourData()]);
  const response = await client.beta.messages.parse({
    model: "claude-opus-5-5",
    max_tokens: 12000,
    // Si el modelo rechazara la petición, la API la reintenta con otro modelo automáticamente
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(AppraisalSchema) },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: userContent(
          photoUrls,
          `Nota del dueño: ${note || "(sin nota)"}

Mercado actual (búsqueda web):
${market || "(no se encontraron datos de mercado)"}

Nuestro inventario (JSON, importes en USD):
${JSON.stringify(data)}`
        ),
      },
    ],
  });
  if (response.stop_reason === "refusal") throw new Error("La IA no pudo analizar estas fotos.");
  if (!response.parsed_output) throw new Error("La IA no devolvió una tasación válida.");
  return response.parsed_output;
}
