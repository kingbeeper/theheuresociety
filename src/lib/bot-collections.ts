import "server-only";
import { receivables, remindClient, waReminderLink } from "./collections";
import { getDocSettings } from "./documents";
import { emailReady } from "./email";
import { escapeHtml as h, keyboard, sendMessage, tg, type InlineButton } from "./telegram";

// 💰 Cobros pendientes por Telegram: lista con el saldo y botones para recordar al cliente

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://theheuresociety.vercel.app").replace(/\/$/, "");

export async function onCollectionsCallback(chatId: number, cbId: string, messageId: number, arg: string, user: string) {
  await tg("answerCallbackQuery", { callback_query_id: cbId }).catch(() => {});
  const [what, id] = arg.split("|");
  const list = await receivables();
  if (what === "mail") {
    await tg("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: keyboard([]) }).catch(() => {});
    const d = list.find((x) => x.id === id);
    if (!d) return sendMessage(chatId, "Ese documento ya no tiene saldo pendiente.");
    const r = await remindClient(d, user, "email").catch((e) => ({ emailed: false, error: (e as Error).message }));
    return sendMessage(chatId, r.emailed ? `✉️ Recordatorio enviado a ${h(d.client_email ?? "")} (${h(d.number)}).` : `⚠️ No se pudo enviar el correo${"error" in r ? `: ${h(String(r.error))}` : ""}.`);
  }
  if (what === "wa") {
    const d = list.find((x) => x.id === id);
    if (d) await remindClient(d, user, "whatsapp");
    return sendMessage(chatId, "✓ Anotado: recordatorio enviado por WhatsApp.");
  }
  // Lista
  if (!list.length) return sendMessage(chatId, "✅ No hay cobros pendientes.");
  const settings = await getDocSettings();
  const total = list.reduce((a, d) => a + d.balance, 0);
  const sorted = [...list].sort((a, b) => (b.overdueDays ?? -1) - (a.overdueDays ?? -1)).slice(0, 8);
  await sendMessage(chatId, `💰 <b>Cobros pendientes</b>: ${usd(total)} en ${list.length} documento(s)`);
  for (const d of sorted) {
    const wa = waReminderLink(d, settings.doc_payment_info);
    const rows: InlineButton[][] = [];
    if (d.client_email && emailReady()) rows.push([{ text: "✉️ Recordar por correo", callback_data: `dcob:mail|${d.id}` }]);
    if (wa) rows.push([{ text: "📲 Recordar por WhatsApp", url: wa }, { text: "✓ Ya se lo envié", callback_data: `dcob:wa|${d.id}` }]);
    rows.push([{ text: "Abrir en el CRM", url: `${SITE}/admin/documentos/${d.id}` }]);
    await sendMessage(
      chatId,
      `<b>${h(d.number)}</b> · ${h(d.client_name ?? "")}\nSaldo <b>${usd(d.balance)}</b> de ${usd(Number(d.total))}${d.overdueDays ? ` · ⚠️ ${d.overdueDays} día(s) de retraso` : d.due_date ? ` · vence ${d.due_date.slice(5).replace("-", "/")}` : ""}${d.last_reminder_at ? `\n<i>Último recordatorio: ${new Date(d.last_reminder_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</i>` : ""}`,
      { reply_markup: keyboard(rows) }
    );
  }
}
