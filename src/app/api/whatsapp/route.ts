import { after } from "next/server";
import { handleWebhook, type WaWebhook } from "@/lib/wa-bot";
import { validRequest } from "@/lib/whatsapp";

// El bot espera unos segundos y consulta a Claude: margen para la función en Vercel
export const maxDuration = 120;

// Meta comprueba la dirección al configurar el webhook (devuelve el «challenge» si el token coincide)
export async function GET(request: Request) {
  const p = new URL(request.url).searchParams;
  const ok = p.get("hub.mode") === "subscribe" && p.get("hub.verify_token") === process.env.WHATSAPP_VERIFY_TOKEN && process.env.WHATSAPP_VERIFY_TOKEN;
  return ok ? new Response(p.get("hub.challenge") ?? "") : new Response("Forbidden", { status: 403 });
}

// Cada mensaje de un cliente (y cada mensaje que el equipo escribe desde la app) llega aquí
export async function POST(request: Request) {
  const raw = await request.text();
  if (!validRequest(raw, request.headers.get("x-hub-signature-256"), new URL(request.url))) {
    return new Response("Unauthorized", { status: 401 });
  }
  const payload = JSON.parse(raw) as WaWebhook;
  // Se responde a WhatsApp enseguida (si tarda, reintenta) y el bot trabaja después
  after(() => handleWebhook(payload).catch((e) => console.error("Error procesando WhatsApp:", e)));
  return new Response("ok");
}
