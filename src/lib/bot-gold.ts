import "server-only";
import { adminDb } from "./supabase";
import { goldChange, KARATS, meltValue, metalPrices, perGram } from "./gold";
import { keyboard, sendMessage, tg } from "./telegram";

// 🥇 Precio del oro por Telegram: el precio de hoy por quilates y la calculadora («12.5 14k»)

const key = (chatId: number) => `tggold:${chatId}`;
const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

export const clearGold = (chatId: number) => adminDb().from("integration_settings").delete().eq("key", key(chatId));

export async function showGold(chatId: number) {
  const p = await metalPrices();
  if (!p) return sendMessage(chatId, "No pude obtener el precio del oro ahora. Prueba en unos minutos.");
  const g = perGram(p, "gold")!;
  const ch = goldChange(p);
  await adminDb().from("integration_settings").upsert({ key: key(chatId), value: "1", updated_at: new Date().toISOString() }, { onConflict: "key" });
  return sendMessage(
    chatId,
    [
      `🥇 <b>Oro hoy: ${usd(p.gold)}/oz</b>${ch != null ? ` (${ch >= 0 ? "▲" : "▼"} ${Math.abs(ch).toFixed(1)}% desde ayer)` : ""}`,
      ...KARATS.map((k) => `${k}k: <b>$${((g * k) / 24).toFixed(2)}</b>/g`),
      "",
      "Para calcular el valor del metal escribe el peso y los quilates, ej. <code>12.5 14k</code> (o <code>30 plata</code>).",
    ].join("\n"),
    { reply_markup: keyboard([[{ text: "✖️ Listo", callback_data: "dgold:x" }]]) }
  );
}

export async function onGoldText(chatId: number, text: string) {
  const { data } = await adminDb().from("integration_settings").select("key").eq("key", key(chatId)).maybeSingle();
  if (!data) return false;
  const m = text.trim().toLowerCase().match(/^(\d+(?:[.,]\d+)?)\s*g?\s*(?:de\s+)?(\d{1,2}\s*k|plata|925|platino|pt)/);
  if (!m) return sendMessage(chatId, "Escribe el peso y los quilates, ej. <code>12.5 14k</code>, o toca «Listo».").then(() => true);
  const p = await metalPrices();
  const metal = /\d+\s*k/.test(m[2]) ? `Oro ${m[2].replace(/\s/g, "")}` : /plata|925/.test(m[2]) ? "Plata 925" : "Platino";
  const v = p ? meltValue(p, metal, m[1].replace(",", ".")) : null;
  if (!v) return sendMessage(chatId, "No pude calcularlo ahora.").then(() => true);
  await sendMessage(chatId, `🥇 ${v.weight} g de ${v.label}: <b>${usd(v.value)}</b> de metal\nPara comprar al peso: 70% ${usd(v.value * 0.7)} · 80% ${usd(v.value * 0.8)} · 90% ${usd(v.value * 0.9)}\n<i>Escribe otro peso o toca «Listo».</i>`, {
    reply_markup: keyboard([[{ text: "✖️ Listo", callback_data: "dgold:x" }]]),
  });
  return true;
}

export async function onGoldCallback(chatId: number, cbId: string, messageId: number, arg: string) {
  await tg("answerCallbackQuery", { callback_query_id: cbId }).catch(() => {});
  if (arg === "x") {
    await tg("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: keyboard([]) }).catch(() => {});
    await clearGold(chatId);
    return;
  }
  return showGold(chatId);
}
