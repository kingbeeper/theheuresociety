import "server-only";

// Cliente mínimo de la API de bots de Telegram (https://core.telegram.org/bots/api)

const token = process.env.TELEGRAM_BOT_TOKEN;
const api = (method: string) => `https://api.telegram.org/bot${token}/${method}`;

export type InlineButton = { text: string; callback_data: string } | { text: string; url: string };

export async function tg<T = unknown>(method: string, body: Record<string, unknown>): Promise<T> {
  if (!token) throw new Error("Falta TELEGRAM_BOT_TOKEN");
  const res = await fetch(api(method), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { ok: boolean; result: T; description?: string };
  if (!json.ok) throw new Error(`Telegram ${method}: ${json.description}`);
  return json.result;
}

export const keyboard = (rows: InlineButton[][]) => ({ inline_keyboard: rows });

export function sendMessage(chatId: number, text: string, extra: Record<string, unknown> = {}) {
  return tg<{ message_id: number }>("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...extra,
  });
}

// Envía una foto por su URL. Si Telegram no logra descargarla (le pasa a veces con
// almacenamiento externo), la descargamos nosotros y se la subimos directamente.
export async function sendPhoto(chatId: number, photo: string, caption: string, extra: Record<string, unknown> = {}) {
  try {
    return await tg<{ message_id: number }>("sendPhoto", { chat_id: chatId, photo, caption, parse_mode: "HTML", ...extra });
  } catch {
    const img = await fetch(photo);
    if (!img.ok) throw new Error(`No se pudo leer la foto (${img.status})`);
    const form = new FormData();
    form.append("chat_id", String(chatId));
    form.append("photo", new Blob([await img.arrayBuffer()], { type: "image/jpeg" }), "photo.jpg");
    form.append("caption", caption);
    form.append("parse_mode", "HTML");
    for (const [k, v] of Object.entries(extra)) form.append(k, typeof v === "string" ? v : JSON.stringify(v));
    const res = await fetch(api("sendPhoto"), { method: "POST", body: form });
    const json = (await res.json()) as { ok: boolean; result: { message_id: number }; description?: string };
    if (!json.ok) throw new Error(`Telegram sendPhoto: ${json.description}`);
    return json.result;
  }
}

// Envía un archivo (PDF de un documento) para reenviarlo desde Telegram
export async function sendDocumentFile(chatId: number, bytes: Uint8Array, filename: string, caption: string, extra: Record<string, unknown> = {}) {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("document", new Blob([Buffer.from(bytes)], { type: "application/pdf" }), filename);
  form.append("caption", caption.slice(0, 1024));
  form.append("parse_mode", "HTML");
  for (const [k, v] of Object.entries(extra)) form.append(k, typeof v === "string" ? v : JSON.stringify(v));
  const res = await fetch(api("sendDocument"), { method: "POST", body: form });
  const json = (await res.json()) as { ok: boolean; description?: string };
  if (!json.ok) throw new Error(`Telegram sendDocument: ${json.description}`);
}

export async function sendVideoFile(chatId: number, bytes: Uint8Array, filename: string, caption: string, extra: Record<string, unknown> = {}) {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("video", new Blob([Buffer.from(bytes)], { type: "video/mp4" }), filename);
  form.append("caption", caption.slice(0, 1024));
  form.append("parse_mode", "HTML");
  form.append("supports_streaming", "true");
  for (const [k, v] of Object.entries(extra)) form.append(k, typeof v === "string" ? v : JSON.stringify(v));
  const res = await fetch(api("sendVideo"), { method: "POST", body: form });
  const json = (await res.json()) as { ok: boolean; description?: string };
  if (!json.ok) throw new Error(`Telegram sendVideo: ${json.description}`);
}

// Descarga una foto recibida (Telegram envía varios tamaños; se usa el mayor)
export async function downloadFile(fileId: string): Promise<ArrayBuffer> {
  const file = await tg<{ file_path: string }>("getFile", { file_id: fileId });
  const res = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`);
  if (!res.ok) throw new Error(`No se pudo descargar la foto (${res.status})`);
  return res.arrayBuffer();
}

export const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// IDs de Telegram autorizados a publicar (separados por comas)
export function isAdmin(userId: number | undefined) {
  if (!userId) return false;
  const ids = (process.env.TELEGRAM_ADMIN_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return ids.includes(String(userId));
}

const adminIds = () => (process.env.TELEGRAM_ADMIN_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

// Aviso a todo el equipo (chat privado de cada administrador). Con fotos, se envían antes del texto.
export async function notifyAdmins(text: string, extra: Record<string, unknown> = {}, photos: string[] = []) {
  for (const id of adminIds()) {
    const chatId = Number(id);
    try {
      if (photos.length > 1) {
        await tg("sendMediaGroup", { chat_id: chatId, media: photos.slice(0, 10).map((media) => ({ type: "photo", media })) });
      } else if (photos.length === 1) {
        await sendPhoto(chatId, photos[0], "");
      }
      await sendMessage(chatId, text, extra);
    } catch (e) {
      console.error("No se pudo avisar al administrador", id, e);
    }
  }
}

// Video (por URL pública) a todo el equipo, p. ej. el reel listo para publicar
export async function notifyAdminsVideo(video: string, caption: string) {
  for (const id of adminIds()) {
    await tg("sendVideo", { chat_id: Number(id), video, caption, parse_mode: "HTML", supports_streaming: true }).catch((e) => console.error("No se pudo enviar el video", id, e));
  }
}
