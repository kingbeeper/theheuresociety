import "server-only";
import { adminDb } from "./supabase";
import { addProformaPayment, closeProforma, getDoc, issueDoc, toProforma } from "./documents";
import { paidSoFar, usd } from "./doc-labels";
import { PAYMENT } from "./stock-labels";
import { todayInMiami } from "./booking";
import { escapeHtml as h, keyboard, sendMessage, tg } from "./telegram";

// Proforma por Telegram: de una cotización aceptada, registrar depósitos (importe → forma de pago)
// y saldarla (forma de pago del saldo → factura pagada en PDF).

const methods = Object.values(PAYMENT);
const pairs = <T,>(xs: T[]) => xs.reduce<T[][]>((acc, x, i) => (i % 2 ? acc[acc.length - 1].push(x) : acc.push([x]), acc), []);
const key = (chatId: number) => `tgpf:${chatId}`;
type Pending = { docId: string; amount?: number; user: string };

async function pending(chatId: number) {
  const { data } = await adminDb().from("integration_settings").select("value").eq("key", key(chatId)).maybeSingle();
  try {
    return data ? (JSON.parse(data.value as string) as Pending) : null;
  } catch {
    return null;
  }
}
const save = (chatId: number, p: Pending) =>
  adminDb().from("integration_settings").upsert({ key: key(chatId), value: JSON.stringify(p), updated_at: new Date().toISOString() }, { onConflict: "key" });
export const clearProforma = (chatId: number) => adminDb().from("integration_settings").delete().eq("key", key(chatId));

const balanceOf = (d: { total: number; payments?: { amount: number }[] }) => Math.max(0, Math.round((Number(d.total) - paidSoFar(d as never)) * 100) / 100);

// «5000», «5k», «$5,000» → 5000
const amount = (t: string) => {
  const m = t.toLowerCase().replace(/[$\s]/g, "").match(/^(\d+(?:[.,]\d+)*)(k)?$/);
  if (!m) return null;
  const n = Number(m[2] ? m[1].replace(",", ".") : m[1].replace(/[.,](?=\d{3}\b)/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.round((m[2] ? n * 1000 : n) * 100) / 100 : null;
};

// Importe del depósito escrito. Devuelve false si no se estaba esperando ninguno.
export async function onProformaText(chatId: number, text: string) {
  const p = await pending(chatId);
  if (!p) return false;
  const n = amount(text);
  if (!n) {
    await sendMessage(chatId, "No entendí el importe. Escribe un número, ej. <code>5000</code>, o /cancelar.");
    return true;
  }
  await save(chatId, { ...p, amount: n });
  await sendMessage(chatId, `💳 Depósito de <b>${usd(n)}</b>: ¿cómo lo pagó?`, { reply_markup: keyboard(pairs(methods.map((m, i) => ({ text: m, callback_data: `dpf:m|${i}` })))) });
  return true;
}

export async function onProformaCallback(chatId: number, cbId: string, messageId: number, arg: string, user: string) {
  const answer = (text?: string) => tg("answerCallbackQuery", { callback_query_id: cbId, ...(text && { text }) }).catch(() => {});
  const clearButtons = () => tg("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: keyboard([]) }).catch(() => {});
  const [what, value] = arg.split("|");
  await answer();
  const { deliver } = await import("./bot-docs");

  // Cotización aceptada → proforma
  if (what === "fromquote") {
    await clearButtons();
    const q = await getDoc(value);
    if (!q || q.kind !== "quote" || !["draft", "sent", "accepted"].includes(q.status)) return sendMessage(chatId, "Esa cotización ya no está abierta.");
    const pf = await toProforma(q, user);
    await issueDoc(pf, user);
    return deliver(chatId, { ...pf, status: "sent" });
  }

  // Depósito: primero el importe (texto), luego la forma de pago
  if (what === "dep") {
    const d = await getDoc(value);
    if (!d || d.kind !== "proforma" || !["draft", "sent"].includes(d.status)) return sendMessage(chatId, "Esa proforma ya está cerrada.");
    await save(chatId, { docId: d.id, user });
    return sendMessage(chatId, `💵 <b>${h(d.number)}</b> · ${h(d.client_name ?? "")}\nTotal ${usd(d.total)} · pagado ${usd(paidSoFar(d))} · saldo <b>${usd(balanceOf(d))}</b>\n\n¿Importe del depósito? (ej. <code>5000</code>)`);
  }
  if (what === "m") {
    await clearButtons();
    const p = await pending(chatId);
    await clearProforma(chatId);
    if (!p?.amount) return sendMessage(chatId, "Ese depósito ya no está en curso.");
    const d = await getDoc(p.docId);
    if (!d || d.kind !== "proforma" || !["draft", "sent"].includes(d.status)) return sendMessage(chatId, "Esa proforma ya está cerrada.");
    const r = await addProformaPayment(d, { date: todayInMiami(), amount: p.amount, method: methods[Number(value)] ?? null }, p.user);
    return sendMessage(chatId, `✅ Depósito registrado en <b>${h(d.number)}</b>\nPagado ${usd(r.deposit)} de ${usd(d.total)} · saldo <b>${usd(r.balance)}</b>${r.balance <= 0 ? "\n\nYa está pagada entera: ¿generas la factura?" : ""}`, {
      reply_markup: keyboard([[{ text: r.balance > 0 ? `✅ Saldada (${usd(r.balance)}): facturar` : "✅ Generar la factura", callback_data: `dpf:close|${d.id}` }], [{ text: "📄 Proforma actualizada (PDF)", callback_data: `dshow:${d.id}` }]]),
    });
  }

  // Saldada: forma de pago del saldo → factura pagada
  if (what === "close") {
    const d = await getDoc(value);
    if (!d || d.kind !== "proforma" || !["draft", "sent"].includes(d.status)) return sendMessage(chatId, "Esa proforma ya está cerrada.");
    const bal = balanceOf(d);
    if (bal <= 0) return finish(chatId, d.id, null, user);
    return sendMessage(chatId, `✅ <b>${h(d.number)}</b> · saldo <b>${usd(bal)}</b>. ¿Cómo pagó el saldo?`, { reply_markup: keyboard(pairs(methods.map((m, i) => ({ text: m, callback_data: `dpf:cm|${d.id}.${i}` })))) });
  }
  if (what === "cm") {
    await clearButtons();
    const [id, i] = value.split(".");
    return finish(chatId, id, methods[Number(i)] ?? null, user);
  }

  async function finish(chat: number, id: string, method: string | null, by: string) {
    const d = await getDoc(id);
    if (!d || d.kind !== "proforma" || !["draft", "sent"].includes(d.status)) return sendMessage(chat, "Esa proforma ya está cerrada.");
    await sendMessage(chat, "⏳ Cerrando la venta y generando la factura…");
    if (d.status === "draft") await issueDoc(d, by);
    const invoice = await closeProforma({ ...d, status: "sent" }, { date: todayInMiami(), method }, by);
    const full = await getDoc(invoice.id);
    await sendMessage(chat, `✅ <b>Venta cerrada</b> · factura ${h(invoice.number)} pagada (${usd(invoice.total)}). El reloj queda vendido en el inventario y en la web.`);
    return full ? deliver(chat, full) : undefined;
  }
}
