import "server-only";
import { adminDb } from "./supabase";
import { EXPENSE_CATEGORY, addExpense } from "./expenses";
import { todayInMiami } from "./booking";
import { escapeHtml as h, keyboard, sendMessage, tg } from "./telegram";

// Gasto general del negocio por Telegram: importe → categoría → detalle (opcional) → guardado.
// Sale en CRM → Dinero (ganancia real del mes) y en el informe del contador.

type Flow = { step: "amount" | "category" | "note"; user: string; amount?: number; category?: string };
const key = (chatId: number) => `tgbex:${chatId}`;
async function getFlow(chatId: number) {
  const { data } = await adminDb().from("integration_settings").select("value").eq("key", key(chatId)).maybeSingle();
  try {
    return data ? (JSON.parse(data.value as string) as Flow) : null;
  } catch {
    return null;
  }
}
const saveFlow = (chatId: number, f: Flow) =>
  adminDb().from("integration_settings").upsert({ key: key(chatId), value: JSON.stringify(f), updated_at: new Date().toISOString() }, { onConflict: "key" });
export const clearExpense = (chatId: number) => adminDb().from("integration_settings").delete().eq("key", key(chatId));

const amount = (t: string) => {
  const m = t.toLowerCase().replace(/[$\s]/g, "").match(/^(\d+(?:[.,]\d+)*)(k)?$/);
  if (!m) return null;
  const n = Number(m[2] ? m[1].replace(",", ".") : m[1].replace(/[.,](?=\d{3}\b)/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.round((m[2] ? n * 1000 : n) * 100) / 100 : null;
};
const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export async function startExpense(chatId: number, user: string) {
  await saveFlow(chatId, { step: "amount", user });
  return sendMessage(chatId, "🏢 <b>Gasto del negocio</b> (renta, marketing, envíos…)\n\n💵 ¿Cuánto fue? (ej. <code>450</code>)\n\n<i>Si es de un reloj concreto (servicio, pulido), usa «🧾 Sumar un gasto» para que cuente en su margen.</i>\n/cancelar para salir.");
}

async function save(chatId: number, f: Flow, note: string | null) {
  await clearExpense(chatId);
  await addExpense({ spent_on: todayInMiami(), category: f.category ?? "other", amount: f.amount ?? 0, note }, f.user);
  return sendMessage(chatId, `✅ Gasto guardado: <b>${usd(f.amount ?? 0)}</b> · ${h(EXPENSE_CATEGORY[f.category ?? "other"] ?? "")}${note ? ` · ${h(note)}` : ""}\nSe resta de la ganancia del mes en CRM → Dinero.`);
}

export async function onExpenseText(chatId: number, text: string) {
  const f = await getFlow(chatId);
  if (!f) return false;
  if (f.step === "amount") {
    const n = amount(text);
    if (!n) return sendMessage(chatId, "No entendí el importe. Escribe un número, ej. <code>450</code>.").then(() => true);
    f.amount = n;
    f.step = "category";
    await saveFlow(chatId, f);
    await sendMessage(chatId, `💵 ${usd(n)} · ¿de qué es?`, {
      reply_markup: keyboard(Object.entries(EXPENSE_CATEGORY).reduce<{ text: string; callback_data: string }[][]>((rows, [k, l], i) => (i % 2 ? rows[rows.length - 1].push({ text: l, callback_data: `dbex:cat|${k}` }) : rows.push([{ text: l, callback_data: `dbex:cat|${k}` }]), rows), [])),
    });
    return true;
  }
  if (f.step === "note") {
    await save(chatId, f, text.slice(0, 200));
    return true;
  }
  await sendMessage(chatId, "Usa los botones de arriba, o /cancelar para salir.");
  return true;
}

export async function onExpenseCallback(chatId: number, cbId: string, messageId: number, arg: string) {
  await tg("answerCallbackQuery", { callback_query_id: cbId }).catch(() => {});
  await tg("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: keyboard([]) }).catch(() => {});
  const f = await getFlow(chatId);
  if (!f) return sendMessage(chatId, "Ese gasto ya no está en curso.");
  const [what, value] = arg.split("|");
  if (what === "cat") {
    f.category = value;
    f.step = "note";
    await saveFlow(chatId, f);
    return sendMessage(chatId, "📝 ¿Algún detalle? (ej. «anuncios de Instagram de octubre»)", { reply_markup: keyboard([[{ text: "Sin detalle", callback_data: "dbex:note|-" }]]) });
  }
  if (what === "note") return save(chatId, f, null);
}
