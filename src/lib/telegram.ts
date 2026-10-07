import "server-only";

// Cliente mínimo de la API de bots de Telegram (https://core.telegram.org/bots/api)

const token = process.env.TELEGRAM_BOT_TOKEN;
const api = (method: string) => `https://api.telegram.org/bot${token}/${method}`;

export type InlineButton = { text: string; callback_data: string };

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

export function sendPhoto(chatId: number, photo: string, caption: string, extra: Record<string, unknown> = {}) {
  return tg<{ message_id: number }>("sendPhoto", { chat_id: chatId, photo, caption, parse_mode: "HTML", ...extra });
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
