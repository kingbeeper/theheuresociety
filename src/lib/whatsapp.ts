import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

// Cliente mínimo de la API de WhatsApp (Cloud API de Meta). Funciona igual con un proveedor
// compatible (p. ej. 360dialog): basta con cambiar WHATSAPP_API_BASE y la clave.
//   Meta:      se conecta desde /es/admin/whatsapp (o WHATSAPP_TOKEN + WHATSAPP_PHONE_NUMBER_ID)
//   360dialog: WHATSAPP_API_BASE=https://waba-v2.360dialog.io + WHATSAPP_TOKEN (su API key)

const BASE = (process.env.WHATSAPP_API_BASE ?? "https://graph.facebook.com/v26.0").replace(/\/$/, "");
const IS_360 = BASE.includes("360dialog");
export const GRAPH = "https://graph.facebook.com/v26.0";

// Credenciales: de las variables de entorno o, si no están, de la conexión hecha desde la
// página /admin/whatsapp (tabla wa_settings). Se guardan en memoria unos minutos.
type Config = { token: string; phoneId: string | null };
let cached: { config: Config | null; at: number } | null = null;

export async function waConfig(): Promise<Config | null> {
  const envToken = process.env.WHATSAPP_TOKEN;
  if (envToken && (IS_360 || process.env.WHATSAPP_PHONE_NUMBER_ID)) {
    return { token: envToken, phoneId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? null };
  }
  if (cached && Date.now() - cached.at < 5 * 60_000) return cached.config;
  let config: Config | null = null;
  try {
    const { adminDb } = await import("./supabase");
    const { data } = await adminDb().from("wa_settings").select("key, value").in("key", ["token", "phone_number_id"]);
    const map = Object.fromEntries((data ?? []).map((r) => [r.key, r.value as string]));
    if (map.token && map.phone_number_id) config = { token: map.token, phoneId: map.phone_number_id };
  } catch {
    config = null;
  }
  cached = { config, at: Date.now() };
  return config;
}

const headersFor = (token: string): Record<string, string> =>
  IS_360 ? { "D360-API-KEY": token } : { Authorization: `Bearer ${token}` };

async function post(body: Record<string, unknown>) {
  const config = await waConfig();
  // Sin conexión (desarrollo local) los envíos se muestran en consola en vez de enviarse
  if (!config) {
    if (process.env.NODE_ENV === "production") throw new Error("WhatsApp no está conectado");
    console.log("[WhatsApp · sin conectar] →", JSON.stringify(body));
    return { messages: [{ id: `local-${Date.now()}` }] };
  }
  const res = await fetch(IS_360 ? `${BASE}/messages` : `${BASE}/${config.phoneId}/messages`, {
    method: "POST",
    headers: { ...headersFor(config.token), "Content-Type": "application/json" },
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
  const config = await waConfig();
  if (!config) throw new Error("WhatsApp no está conectado");
  const headers = headersFor(config.token);
  const info = await fetch(`${BASE}/${mediaId}`, { headers });
  if (!info.ok) throw new Error(`No se pudo leer el archivo (${info.status})`);
  const { url, mime_type } = (await info.json()) as { url: string; mime_type: string };
  // Con 360dialog la URL de Meta se descarga a través de su dominio
  const fileUrl = IS_360 ? url.replace("https://lookaside.fbsbx.com", BASE) : url;
  const file = await fetch(fileUrl, { headers });
  if (!file.ok) throw new Error(`No se pudo descargar el archivo (${file.status})`);
  return { bytes: Buffer.from(await file.arrayBuffer()), mimeType: mime_type };
}

// ¿La llamada viene de verdad de WhatsApp?
// - Meta firma cada llamada con el secreto de la app (cabecera X-Hub-Signature-256).
// - 360dialog no firma: su webhook se registra con ?key=WHATSAPP_VERIFY_TOKEN en la URL.
// - Sin secreto configurado, solo se aceptan llamadas en desarrollo local (para probar el bot).
export function validRequest(rawBody: string, signature: string | null, url: URL) {
  if (IS_360) return Boolean(process.env.WHATSAPP_VERIFY_TOKEN) && url.searchParams.get("key") === process.env.WHATSAPP_VERIFY_TOKEN;
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  if (!signature?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  const given = Buffer.from(signature.slice(7), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
