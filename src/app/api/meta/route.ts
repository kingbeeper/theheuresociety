import { after } from "next/server";
import { META_VERIFY_TOKEN, validMetaSignature } from "@/lib/meta";
import { handleMetaWebhook, type MetaWebhook } from "@/lib/social-bot";

// Avisos de Meta para Instagram (DM y comentarios) y la página de Facebook (Messenger y comentarios)
export const maxDuration = 120;

// Comprobación al configurar el webhook en la app de Meta
export async function GET(request: Request) {
  const p = new URL(request.url).searchParams;
  const ok = META_VERIFY_TOKEN && p.get("hub.mode") === "subscribe" && p.get("hub.verify_token") === META_VERIFY_TOKEN;
  return ok ? new Response(p.get("hub.challenge") ?? "") : new Response("Forbidden", { status: 403 });
}

export async function POST(request: Request) {
  const raw = await request.text();
  if (!validMetaSignature(raw, request.headers.get("x-hub-signature-256"))) {
    return new Response("Unauthorized", { status: 401 });
  }
  const payload = JSON.parse(raw) as MetaWebhook;
  after(() => handleMetaWebhook(payload).catch((e) => console.error("Error procesando aviso de Meta:", e)));
  return new Response("ok");
}
