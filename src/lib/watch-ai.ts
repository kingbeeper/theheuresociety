import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

const localized = z.object({ en: z.string(), es: z.string() });

// Lo que la IA devuelve para cada reloj: coincide con la tabla `watches`
export const WatchDraftSchema = z.object({
  brand: z.string(),
  model: z.string(),
  reference: z.string(),
  year: z.number().int().nullable(),
  caseSize: z.string(),
  material: localized,
  dial: localized.nullable(),
  bracelet: localized.nullable(),
  movement: z.string().nullable(),
  powerReserve: z.string().nullable(),
  waterResistance: z.string().nullable(),
  description: localized,
  price: z.number().nullable(),
  currency: z.string(),
  hasBox: z.boolean(),
  hasPapers: z.boolean(),
  confidence: z.enum(["high", "medium", "low"]),
  warnings: z.array(z.string()),
});
export type WatchDraft = z.infer<typeof WatchDraftSchema>;

const SYSTEM = `Eres el especialista en relojería de The Heure Society, una tienda privada de relojes de lujo de segunda mano. El administrador te envía fotos reales de un reloj de su inventario y una nota corta (marca, modelo o referencia, precio y si incluye caja y papeles). Tu trabajo es preparar la ficha para publicarla en la web.

Reglas:
- La nota del administrador manda en la referencia, el precio, la moneda y si incluye caja y papeles. Si no indica precio, price es null ("precio a consultar"). Si no indica moneda, usa USD. Interpreta "14.5k", "14,500" o "14500" como 14500.
- Comprueba con las fotos que el reloj coincide con la referencia indicada (esfera, bisel, material, brazalete, complicaciones). Si algo no cuadra, explícalo en "warnings" en español y baja "confidence". Si no puedes ver un detalle, no lo des por hecho.
- La ficha técnica (calibre, reserva de marcha, hermeticidad, diámetro) debe corresponder a las especificaciones publicadas de esa referencia exacta. Si no estás seguro de un dato, déjalo en null en lugar de adivinar, y añádelo a "warnings".
- No describas el estado del reloj más allá de lo que se ve o de lo que dice la nota. No inventes historia, ediciones limitadas ni rarezas.
- Descripción: 2 a 4 frases, tono elegante y sobrio, sin exageraciones ni signos de exclamación. Español neutro tratando de "usted"; inglés natural. Menciona lo que hace especial a la pieza y si incluye caja y papeles.
- "model" es el nombre comercial sin la marca (ej. "Cosmograph Daytona"). "caseSize" con unidad (ej. "40 mm").`;

const client = new Anthropic();

export async function analyzeWatch(photoUrls: string[], note: string): Promise<WatchDraft> {
  const response = await client.beta.messages.parse({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    // Si el modelo rechazara la petición, la API la reintenta con otro modelo automáticamente
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(WatchDraftSchema) },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          ...photoUrls.map((url) => ({ type: "image" as const, source: { type: "url" as const, url } })),
          { type: "text", text: `Nota del administrador: ${note || "(sin nota)"}` },
        ],
      },
    ],
  });

  if (response.stop_reason === "refusal") throw new Error("La IA no pudo procesar estas fotos.");
  if (!response.parsed_output) throw new Error("La IA no devolvió una ficha válida.");
  return response.parsed_output;
}
