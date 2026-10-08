import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

// Cliente mínimo de la API de WhatsApp (Cloud API de Meta). Funciona igual con un proveedor
// compatible (p. ej. 360dialog): basta con cambiar WHATSAPP_API_BASE y la clave.
//   Meta:      WHATSAPP_API_BASE=https://graph.facebook.com/v26.0  + WHATSAPP_PHONE_NUMBER_ID + WHATSAPP_TOKEN
//   360dialog: WHATSAPP_API_BASE=https://waba-v2.360dialog.io      + WHATSAPP_TOKEN (su API key)

const BASE = (process.env.WHATSAPP_API_BASE ?? "https://graph.facebook.com/v26.0").replace(/\/$/, "");
const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const IS_360 = BASE.includes("360dialog");

export const whatsappConfigured = Boolean(TOKEN && (IS_360 || PHONE_ID));

const headers = (): Record<string, string> =>
  IS_360 ? { "D360-API-KEY": TOKEN! } : { Authorization: `Bearer ${TOKEN}` };

async function post(body: Record<string, unknown>) {
  // Sin credenciales (desarrollo local) los envíos se muestran en consola en vez de enviarse
  if (!whatsappConfigured) {
    console.log("[WhatsApp · sin configurar] →", JSON.stringify(body));
    return { messages: [{ id: `local-${Date.now()}` }] };
  }
  const res = await fetch(IS_360 ? `${BASE}/messages` : `${BASE}/${PHONE_ID}/messages`, {
    method: "POST",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", ...body }),
  });
  const json = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message: string } };
  if (!res.ok) throw new Error(`WhatsApp ${res.status}: ${json.error?.message ?? "error"}`);
  return json;
}

// WhatsApp admite hasta 4096 caracteres por mensaje
export async function sendText(to: string, text: string) {
  const ids: string[] = [];
  for (let rest = text.trim(); rest; ) {
    let cut = rest.length <= 4000 ? rest.length : rest.lastIndexOf("\n", 4000);
    if (cut < 1000) cut = 4000;
    const r = await post({ to, type: "text", text: { body: rest.slice(0, cut), preview_url: true } });
    ids.push(r.messages?.[0]?.id ?? "");
    rest = rest.slice(cut).trim();
  }
  return ids;
}

export async function sendImage(to: string, link: string, caption?: string) {
  const r = await post({ to, type: "image", image: { link, ...(caption && { caption }) } });
  return r.messages?.[0]?.id ?? "";
}

// Marca el mensaje como leído y muestra «escribiendo…» mientras el bot prepara la respuesta
export async function markReadTyping(messageId: string) {
  await post({ status: "read", message_id: messageId, typing_indicator: { type: "text" } }).catch((e) =>
    console.error("No se pudo marcar como leído:", e)
  );
}

// Descarga un archivo recibido (foto, documento…) a partir de su id de WhatsApp
export async function downloadMedia(mediaId: string) {
  const info = await fetch(`${BASE}/${mediaId}`, { headers: headers() });
  if (!info.ok) throw new Error(`No se pudo leer el archivo (${info.status})`);
  const { url, mime_type } = (await info.json()) as { url: string; mime_type: string };
  // Con 360dialog la URL de Meta se descarga a través de su dominio
  const fileUrl = IS_360 ? url.replace("https://lookaside.fbsbx.com", BASE) : url;
  const file = await fetch(fileUrl, { headers: headers() });
  if (!file.ok) throw new Error(`No se pudo descargar el archivo (${file.status})`);
  return { bytes: Buffer.from(await file.arrayBuffer()), mimeType: mime_type };
}

// ¿La llamada viene de verdad de WhatsApp?
// - Meta firma cada llamada con el secreto de la app (cabecera X-Hub-Signature-256).
// - 360dialog no firma: su webhook se registra con ?key=WHATSAPP_VERIFY_TOKEN en la URL.
// - Sin configurar, solo se aceptan llamadas en desarrollo local (para probar el bot).
export function validRequest(rawBody: string, signature: string | null, url: URL) {
  if (!whatsappConfigured) return process.env.NODE_ENV !== "production";
  if (IS_360) return Boolean(process.env.WHATSAPP_VERIFY_TOKEN) && url.searchParams.get("key") === process.env.WHATSAPP_VERIFY_TOKEN;
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret || !signature?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  const given = Buffer.from(signature.slice(7), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
