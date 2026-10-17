import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

// Leer la tarjeta de garantía (o los papeles) de un reloj con una foto: marca, modelo, referencia,
// número de serie y fecha. Sirve para dar de alta un reloj sin copiar a mano (y sin errores en el serial).

const client = new Anthropic();
const MODEL = "claude-sonnet-5-5";

const CardSchema = z.object({
  brand: z.string().nullable().describe("Marca (Rolex, Patek Philippe…)"),
  model: z.string().nullable().describe("Modelo si aparece o se deduce con seguridad de la referencia (Submariner Date, Nautilus…)"),
  reference: z.string().nullable().describe("Referencia / modelo número, tal cual (126610LN, 5711/1A-010…)"),
  serial: z.string().nullable().describe("Número de serie EXACTO, carácter por carácter; null si no se lee con seguridad"),
  papers_date: z.string().nullable().describe("Fecha de la tarjeta/garantía en formato AAAA-MM-DD (si solo hay mes y año, usa el día 01)"),
  retailer: z.string().nullable().describe("Distribuidor o tienda que la emitió, si aparece"),
  doubtful: z.array(z.string()).describe("Campos que no se leen con seguridad (borrosos, tapados, reflejos)"),
  notes: z.string().describe("Una frase en español con lo relevante (p. ej. «tarjeta Rolex de garantía internacional, 2021»)"),
});
export type WarrantyCard = z.infer<typeof CardSchema>;

type Image = { base64: string; mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif" } | { url: string };

export async function readWarrantyCard(image: Image): Promise<WarrantyCard | null> {
  const source = "url" in image ? { type: "url" as const, url: image.url } : { type: "base64" as const, media_type: image.mediaType, data: image.base64 };
  const res = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 1500,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { format: betaZodOutputFormat(CardSchema) },
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source },
          {
            type: "text",
            text: "Es la foto de la tarjeta de garantía (o certificado/papeles) de un reloj de lujo. Extrae marca, modelo, referencia, número de serie y fecha. El serial tiene que ser exacto: si algún carácter no se lee con seguridad, devuelve null y márcalo en «doubtful». No inventes nada que no se vea.",
          },
        ],
      },
    ],
  });
  return res.parsed_output ?? null;
}
