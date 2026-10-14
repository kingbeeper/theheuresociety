import "server-only";
import { adminDb } from "./supabase";
import { serialHistory, serialSummary } from "./serials";
import { keyboard, sendMessage } from "./telegram";

// Número de serie por Telegram: se pregunta al publicar un reloj nuevo (antes del costo) y se
// comprueba al momento si ese reloj ya pasó por el sistema. También /serial <número>.

type Pending = { itemId: string; then: "cost" | null };
const key = (chatId: number) => `tgserial:${chatId}`;

export async function askSerial(chatId: number, itemId: string, then: Pending["then"] = null) {
  await adminDb().from("integration_settings").upsert({ key: key(chatId), value: JSON.stringify({ itemId, then }), updated_at: new Date().toISOString() }, { onConflict: "key" });
  return sendMessage(chatId, "🔢 ¿<b>Número de serie</b> del reloj? Queda en el historial y te aviso si ya pasó antes por el sistema.", {
    reply_markup: keyboard([[{ text: "Omitir", callback_data: `dsno:${itemId}` }]]),
  });
}

async function pending(chatId: number) {
  const { data } = await adminDb().from("integration_settings").select("value").eq("key", key(chatId)).maybeSingle();
  try {
    return data ? (JSON.parse(data.value as string) as Pending) : null;
  } catch {
    return null;
  }
}
export const clearSerial = (chatId: number) => adminDb().from("integration_settings").delete().eq("key", key(chatId));

async function next(chatId: number, p: Pending) {
  await clearSerial(chatId);
  if (p.then === "cost") {
    const { askCost } = await import("./bot-docs");
    await askCost(chatId, p.itemId);
  }
}

// Respuesta a la pregunta del serial. Devuelve false si no había ninguna pendiente.
export async function onSerialText(chatId: number, text: string) {
  const p = await pending(chatId);
  if (!p) return false;
  const serial = text.trim();
  // Un serial es un código corto con números: otro texto se toma como «sin serial» y se sigue
  if (!/^[a-z0-9][a-z0-9 -]{2,24}$/i.test(serial) || !/\d/.test(serial)) {
    await sendMessage(chatId, "Eso no parece un número de serie: lo dejo sin serial. Puedes ponerlo luego en la ficha del CRM.");
    await next(chatId, p);
    return true;
  }
  await adminDb().from("inventory_items").update({ serial, updated_at: new Date().toISOString() }).eq("id", p.itemId);
  const rows = await serialHistory(serial, { excludeItemId: p.itemId });
  await sendMessage(chatId, rows.length ? serialSummary(rows, serial) : `✅ Serial <code>${serial.replace(/</g, "")}</code> guardado. No había pasado antes por el sistema.`);
  await next(chatId, p);
  return true;
}

export async function onSerialSkip(chatId: number) {
  const p = await pending(chatId);
  if (p) await next(chatId, p);
}

export async function serialCommand(chatId: number, arg: string) {
  if (!arg.trim()) return sendMessage(chatId, "Escribe el número después del comando, por ejemplo: <code>/serial 7K3P9921</code>");
  return sendMessage(chatId, serialSummary(await serialHistory(arg), arg.trim()));
}
