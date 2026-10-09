import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { adminDb } from "./supabase";

// Tasación rápida por foto: identifica el reloj y sugiere un rango de oferta a partir de NUESTRAS
// compras y ventas de piezas parecidas. Es orientativa: la decisión final es siempre del dueño.

const AppraisalSchema = z.object({
  brand: z.string(),
  model: z.string(),
  reference: z.string().nullable(),
  confidence: z.enum(["high", "medium", "low"]),
  observations: z.array(z.string()).describe("Lo que se ve en las fotos: estado, detalles, posibles problemas"),
  comparables: z.array(z.object({ sku: z.string(), note: z.string() })).describe("Relojes de nuestros datos que se parecen y por qué"),
  data_summary: z.string().describe("Resumen de lo que dicen nuestros datos (o que no hay suficientes)"),
  offer_low: z.number().nullable(),
  offer_high: z.number().nullable(),
  expected_sale: z.number().nullable(),
  basis: z.enum(["our_data", "general_estimate", "insufficient"]),
  warnings: z.array(z.string()),
});
export type Appraisal = z.infer<typeof AppraisalSchema>;

const SYSTEM = `Eres el especialista en compras de The Heure Society, un dealer de relojes de lujo de segunda mano en Miami. El dueño te envía fotos del reloj que le ofrecen y una nota (lo que dice el vendedor, el precio que pide, si trae caja y papeles…).

Tu trabajo:
1. Identifica marca, modelo y referencia por las fotos y la nota. Si no estás seguro, dilo y baja "confidence".
2. Describe lo que ves (estado del cristal, bisel, brazalete, pulido, esfera…). No des por hecho lo que no se ve.
3. Usa SOLO los datos de nuestro inventario que te paso (costos, precios previstos y ventas reales con fechas) para sugerir un rango de oferta ("offer_low"-"offer_high") y un precio de venta esperado. Busca piezas iguales o muy parecidas (misma referencia o familia, estado y si tienen caja y papeles). Explica en "data_summary" en qué te basas.
4. Si nuestros datos no bastan, puedes dar una estimación general con "basis" = "general_estimate", siendo prudente (rango amplio) y avisándolo en "warnings": hay que contrastarla con el mercado actual (Chrono24, WatchCharts). Si no puedes ni eso, deja los importes en null y "basis" = "insufficient".
5. Los importes en dólares, redondeados a 50. Escribe todo en español.
Nunca afirmes que un reloj es auténtico solo por las fotos.`;

const client = new Anthropic();

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
  const data = await ourData();
  const response = await client.beta.messages.parse({
    model: "claude-opus-5-5",
    max_tokens: 8000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(AppraisalSchema) },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          ...photoUrls.map((url) => ({ type: "image" as const, source: { type: "url" as const, url } })),
          { type: "text", text: `Nota del dueño: ${note || "(sin nota)"}\n\nNuestro inventario (JSON, importes en USD):\n${JSON.stringify(data)}` },
        ],
      },
    ],
  });
  if (response.stop_reason === "refusal") throw new Error("La IA no pudo analizar estas fotos.");
  if (!response.parsed_output) throw new Error("La IA no devolvió una tasación válida.");
  return response.parsed_output;
}
