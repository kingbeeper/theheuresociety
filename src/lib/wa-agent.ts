import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { booking, contact } from "./site";
import { formatPrice, type Watch } from "./watches";
import { SITE_URL } from "./seo";

// El asistente de WhatsApp: Claude con herramientas para consultar el inventario real,
// ofrecer horarios, solicitar citas, registrar relojes para vender/consignar y pasar con
// una persona. Las acciones con efecto (enviar, guardar, avisar) se reciben desde fuera,
// así se puede probar sin tocar nada real.

export type HistoryItem = { direction: "in" | "bot" | "staff"; type: string; body: string | null; media_url: string | null };

export type AgentDeps = {
  name: string | null;
  inventory: () => Promise<Watch[]>;
  takenSlots: () => Promise<Date[]>;
  upcomingSlots: (taken: Date[], fromKey?: string) => { date: string; weekday: string; times: string[] }[];
  isBookable: (date: string, time: string) => boolean;
  sendImage: (link: string, caption: string) => Promise<void>;
  requestAppointment: (a: { kind: "office" | "video"; date: string; time: string; name: string; email?: string; pieces: string[]; note?: string }) => Promise<"ok" | "taken">;
  submitWatch: (s: { kind: "sell" | "trade" | "consign"; name: string; brand: string; model?: string; reference?: string; details?: string }) => Promise<number>;
  handoff: (reason: string) => Promise<void>;
  saveInterest: (i: { query: string; budget?: string; alert: boolean }) => Promise<void>;
  now: () => Date;
};

const client = new Anthropic();
const MODEL = "claude-sonnet-5-5";

const HOURS = contact.openingHours.map((h) => `${h.days.join(", ")}: ${h.opens}–${h.closes}`).join("; ");

const SYSTEM = `Eres el asistente de WhatsApp de The Heure Society, una tienda privada de relojes de lujo de segunda mano en Miami (Rolex, Audemars Piguet, Patek Philippe, Cartier, Richard Mille y otras grandes casas). Atiendes a clientes que escriben al WhatsApp de la tienda.

Datos del negocio:
- Oficina: ${contact.address.street}, ${contact.address.city}, ${contact.address.region} ${contact.address.postalCode}. Solo con cita previa.
- Horario (hora de Miami): ${HOURS}. Domingo cerrado.
- Teléfono: ${contact.phoneDisplay}. Web: ${SITE_URL}. Instagram: ${contact.instagram}
- Citas de ${booking.durationMinutes} minutos, en la oficina o por videollamada.
- Compramos, intercambiamos y vendemos en consignación relojes de nuestros clientes. Cada pieza se autentica antes de publicarse. Envíos discretos y asegurados a todo el mundo.

Cómo trabajas:
- Responde siempre en el idioma del cliente (español o inglés, o el que use). En español trata de «usted».
- Estilo WhatsApp: breve (1 a 4 frases), cálido y elegante, sin listas largas ni encabezados. Para resaltar usa *negrita* de WhatsApp con moderación. Pon las URL tal cual, sin formato Markdown. Como mucho un emoji discreto, y solo si el cliente los usa.
- Para cualquier dato de un reloj (si lo tenemos, estado, precio, especificaciones) usa siempre las herramientas. Nunca inventes piezas, referencias, precios ni disponibilidad. Si no lo tenemos, dilo y ofrece avisarle o buscarlo: en ese caso pásalo a una persona con el motivo.
- Precios: di el precio solo si la herramienta lo da. Si es «Precio a consultar», ofrece que le contacte una persona del equipo. Nunca negocies, ni ofrezcas descuentos, ni prometas un precio de compra por el reloj del cliente.
- Al hablar de un reloj concreto, ofrece la foto (herramienta enviar_foto) y el enlace a su ficha.
- Cuando el cliente diga qué busca (o su presupuesto), guárdalo con registrar_interes. Si no tenemos lo que busca, ofrécele avisarle cuando llegue y, si acepta, regístralo con avisar=true.
- Citas: ofrece los horarios con la herramienta y, cuando el cliente elija tipo (oficina o videollamada), día y hora, pide su nombre (y opcionalmente correo) y solicita la cita. Explica que es una solicitud y que el equipo la confirmará por este chat.
- Vender, intercambiar o consignar: pide marca y modelo o referencia, estado, si tiene caja y papeles, año aproximado, y fotos (esfera, caja, brazalete y papeles si los tiene). Cuando tengas lo esencial y al menos una foto, regístralo con la herramienta. No valores el reloj: un especialista responde con una oferta.
- Pasa con una persona (herramienta pasar_a_persona) cuando el cliente lo pida, quiera comprar o reservar un reloj, pregunte por formas de pago, negocie, tenga una queja, o cuando no sepas algo. Tras usarla, dile que alguien del equipo le escribirá en breve y no sigas la conversación por tu cuenta.
- Nunca pidas ni aceptes datos de tarjetas, cuentas bancarias o documentos de identidad.
- Si el cliente envía una nota de voz, pídele amablemente que lo escriba.
- Los mensajes marcados como [Equipo] los escribió una persona de la tienda: respétalos y no los contradigas.`;

const watchSummary = (w: Watch, lang: "es" | "en") => ({
  slug: w.slug,
  marca: w.brand,
  modelo: w.model,
  referencia: w.reference,
  año: w.year ?? null,
  caja: w.caseSize,
  material: w.material[lang],
  estado: w.status === "available" ? "disponible" : w.status === "reserved" ? "reservado" : "vendido",
  precio: formatPrice(w, lang === "es" ? "es" : "en"),
  caja_y_papeles: [w.hasBox && "caja", w.hasPapers && "papeles"].filter(Boolean).join(" y ") || "solo reloj",
  ficha: `${SITE_URL}/${lang}/watches/${w.slug}`,
  tiene_foto: w.images.some((i) => i.startsWith("http")),
});

// El historial de WhatsApp en el formato de mensajes de Claude (turnos alternos)
function toMessages(history: HistoryItem[]): Anthropic.Beta.Messages.BetaMessageParam[] {
  const out: Anthropic.Beta.Messages.BetaMessageParam[] = [];
  const imagesFrom = history.length - 8; // solo las fotos recientes, para no cargar el contexto
  history.forEach((h, i) => {
    const role = h.direction === "in" ? "user" : "assistant";
    const blocks: Anthropic.Beta.Messages.BetaContentBlockParam[] = [];
    if (h.direction === "in" && h.type === "image" && h.media_url && i >= imagesFrom) {
      blocks.push({ type: "image", source: { type: "url", url: h.media_url } });
    }
    const label = h.type === "audio" ? "[Nota de voz]" : h.type !== "text" && h.type !== "image" ? `[${h.type}]` : "";
    const text = [h.direction === "staff" ? "[Equipo]" : "", label, h.body ?? ""].filter(Boolean).join(" ").trim();
    if (text) blocks.push({ type: "text", text });
    else if (!blocks.length) blocks.push({ type: "text", text: h.type === "image" ? "[Foto]" : `[${h.type}]` });
    const last = out[out.length - 1];
    if (last?.role === role && Array.isArray(last.content)) last.content.push(...blocks);
    else out.push({ role, content: blocks });
  });
  // La conversación debe empezar por el cliente
  while (out[0]?.role === "assistant") out.shift();
  return out;
}

export async function runAgent(history: HistoryItem[], deps: AgentDeps) {
  // Idioma probable para las fichas (el modelo responde en el idioma del cliente igualmente)
  const lastIn = [...history].reverse().find((h) => h.direction === "in" && h.body)?.body ?? "";
  const lang: "es" | "en" = /[áéíóúñ¿¡]|\b(hola|quiero|precio|tienen|reloj|gracias|buen[oa]s)\b/i.test(lastIn) ? "es" : "en";

  const tools = [
    betaZodTool({
      name: "buscar_relojes",
      description: "Lista los relojes del inventario (disponibles y reservados) con precio, estado y enlace a su ficha. Filtra por texto libre (marca, modelo o referencia) si se indica.",
      inputSchema: z.object({ consulta: z.string().optional().describe("Marca, modelo o referencia; vacío para ver todo") }),
      run: async ({ consulta }) => {
        const all = (await deps.inventory()).filter((w) => w.status !== "sold");
        const q = (consulta ?? "").toLowerCase().trim();
        const words = q.split(/\s+/).filter(Boolean);
        const hits = words.length
          ? all.filter((w) => words.every((x) => `${w.brand} ${w.model} ${w.reference}`.toLowerCase().includes(x)))
          : all;
        const list = (hits.length ? hits : all).map((w) => watchSummary(w, lang));
        return JSON.stringify({ coincidencias_exactas: hits.length > 0, relojes: list });
      },
    }),
    betaZodTool({
      name: "ver_reloj",
      description: "Ficha completa de un reloj: especificaciones y descripción.",
      inputSchema: z.object({ slug: z.string() }),
      run: async ({ slug }) => {
        const w = (await deps.inventory()).find((x) => x.slug === slug);
        if (!w) return "No existe ese reloj.";
        return JSON.stringify({
          ...watchSummary(w, lang),
          esfera: w.dial?.[lang], brazalete: w.bracelet?.[lang], movimiento: w.movement,
          reserva_de_marcha: w.powerReserve, hermeticidad: w.waterResistance, descripcion: w.description?.[lang],
        });
      },
    }),
    betaZodTool({
      name: "enviar_foto",
      description: "Envía al cliente la foto principal de un reloj, con su nombre y el enlace a la ficha.",
      inputSchema: z.object({ slug: z.string() }),
      run: async ({ slug }) => {
        const w = (await deps.inventory()).find((x) => x.slug === slug);
        const img = w?.images.find((i) => i.startsWith("http"));
        if (!w || !img) return "Ese reloj no tiene foto disponible.";
        await deps.sendImage(img, `*${w.brand} ${w.model}* · Ref. ${w.reference}\n${SITE_URL}/${lang}/watches/${w.slug}`);
        return "Foto enviada al cliente (no repitas el enlace).";
      },
    }),
    betaZodTool({
      name: "horarios_disponibles",
      description: "Próximos días y horas libres para una cita (hora de Miami).",
      inputSchema: z.object({ desde: z.string().optional().describe("Fecha AAAA-MM-DD desde la que buscar, si el cliente pide un día concreto") }),
      run: async ({ desde }) => JSON.stringify(deps.upcomingSlots(await deps.takenSlots(), desde)),
    }),
    betaZodTool({
      name: "solicitar_cita",
      description: "Registra una solicitud de cita y avisa al equipo para que la confirme. Usar solo cuando el cliente ya eligió tipo, día y hora y dio su nombre.",
      inputSchema: z.object({
        tipo: z.enum(["office", "video"]).describe("office = en la oficina; video = videollamada"),
        fecha: z.string().describe("AAAA-MM-DD"),
        hora: z.string().describe("HH:MM, de las ofrecidas"),
        nombre: z.string(),
        email: z.string().optional(),
        relojes: z.array(z.string()).optional().describe("slugs de los relojes que quiere ver"),
        nota: z.string().optional(),
      }),
      run: async (a) => {
        if (!deps.isBookable(a.fecha, a.hora)) return "Ese día u hora no está disponible. Ofrece otros con horarios_disponibles.";
        const r = await deps.requestAppointment({ kind: a.tipo, date: a.fecha, time: a.hora, name: a.nombre, email: a.email, pieces: a.relojes ?? [], note: a.nota });
        return r === "ok"
          ? "Solicitud registrada y equipo avisado. Dile al cliente que se la confirmaremos por este chat."
          : "Ese horario acaba de ocuparse. Ofrece otros.";
      },
    }),
    betaZodTool({
      name: "registrar_reloj_cliente",
      description: "Registra un reloj que el cliente quiere vender, intercambiar o dejar en consignación, con las fotos que ya envió, y avisa al especialista.",
      inputSchema: z.object({
        tipo: z.enum(["sell", "trade", "consign"]),
        nombre: z.string().describe("Nombre del cliente"),
        marca: z.string(),
        modelo: z.string().optional(),
        referencia: z.string().optional(),
        detalles: z.string().optional().describe("Estado, año, caja y papeles, precio que espera, etc."),
      }),
      run: async (s) => {
        const photos = await deps.submitWatch({ kind: s.tipo, name: s.nombre, brand: s.marca, model: s.modelo, reference: s.referencia, details: s.detalles });
        return `Registrado con ${photos} foto(s) y especialista avisado. Dile al cliente que le responderemos con una oferta en breve.`;
      },
    }),
    betaZodTool({
      name: "registrar_interes",
      description: "Guarda en la ficha del cliente qué reloj busca y su presupuesto. Úsala siempre que el cliente diga qué busca. Con avisar=true, el equipo le avisará cuando llegue una pieza así (úsalo si no la tenemos y el cliente acepta que le avisemos).",
      inputSchema: z.object({
        busca: z.string().describe("Marca, modelo, referencia o descripción de lo que busca"),
        presupuesto: z.string().optional(),
        avisar: z.boolean().describe("true si quiere que le avisemos cuando llegue"),
      }),
      run: async ({ busca, presupuesto, avisar }) => {
        await deps.saveInterest({ query: busca, budget: presupuesto, alert: avisar });
        return avisar ? "Guardado. Le avisaremos cuando llegue una pieza así." : "Guardado en su ficha.";
      },
    }),
    betaZodTool({
      name: "pasar_a_persona",
      description: "Avisa al equipo para que una persona continúe la conversación. El bot deja de responder en este chat.",
      inputSchema: z.object({ motivo: z.string().describe("Resumen breve de lo que necesita el cliente") }),
      run: async ({ motivo }) => {
        await deps.handoff(motivo);
        return "Equipo avisado. Despídete diciendo que una persona le escribirá en breve.";
      },
    }),
  ];

  const now = deps.now();
  const today = new Intl.DateTimeFormat("es-ES", { timeZone: "America/New_York", dateStyle: "full", timeStyle: "short" }).format(now);

  const final = await client.beta.messages.toolRunner({
    model: MODEL,
    max_tokens: 2000,
    max_iterations: 8,
    system: [
      { type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } },
      { type: "text", text: `Ahora en Miami: ${today}.${deps.name ? ` El cliente se llama ${deps.name} en WhatsApp.` : ""}` },
    ],
    messages: toMessages(history),
    tools,
  });

  return final.content
    .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}
