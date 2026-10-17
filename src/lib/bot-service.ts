import "server-only";
import { openServices, readyMessage, serviceStep } from "./service";
import { SERVICE_STATUS, usd } from "./doc-labels";
import { escapeHtml as h, keyboard, sendMessage, tg, type InlineButton } from "./telegram";

// 🔧 Servicios en curso por Telegram: cada orden con botones para avanzarla (taller, lista, entregada)

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://theheuresociety.vercel.app").replace(/\/$/, "");

export async function onServiceCallback(chatId: number, cbId: string, messageId: number, arg: string, user: string) {
  await tg("answerCallbackQuery", { callback_query_id: cbId }).catch(() => {});
  const [what, id] = arg.split("|");
  if (what === "list") {
    const list = await openServices();
    if (!list.length) return sendMessage(chatId, "✅ No hay servicios en curso. Se crean en el CRM: Documentos → + Orden de servicio.");
    for (const d of list.slice(0, 10)) {
      const s = d.service!;
      const rows: InlineButton[][] = [];
      if (s.status === "received") rows.push([{ text: "🔧 Al taller", callback_data: `dsvc:workshop|${d.id}` }]);
      if (s.status === "received" || s.status === "workshop") rows.push([{ text: "✅ Está lista", callback_data: `dsvc:ready|${d.id}` }]);
      if (s.status === "ready") rows.push([{ text: `💵 Entregada y cobrada${Number(d.total) ? ` (${usd(d.total)})` : ""}`, callback_data: `dsvc:delivered|${d.id}` }]);
      rows.push([{ text: "Abrir en el CRM", url: `${SITE}/admin/documentos/${d.id}` }]);
      await sendMessage(chatId, `🔧 <b>${h(d.number)}</b> · ${h(d.client_name ?? "")}\n${h(s.piece)}\n${SERVICE_STATUS[s.status]}${s.provider ? ` · ${h(s.provider)}` : ""}${d.due_date ? ` · lista para ${d.due_date.slice(5).replace("-", "/")}` : ""}`, { reply_markup: keyboard(rows) });
    }
    return;
  }
  if (!["workshop", "ready", "delivered"].includes(what)) return;
  await tg("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: keyboard([]) }).catch(() => {});
  try {
    const r = await serviceStep(id, what as "workshop" | "ready" | "delivered", user);
    const d = r.doc;
    const phone = d.client_phone?.replace(/\D/g, "");
    if (what === "ready")
      return sendMessage(chatId, `✅ <b>${h(d.number)}</b> lista.`, phone ? { reply_markup: keyboard([[{ text: "📲 Avisar al cliente por WhatsApp", url: `https://wa.me/${phone}?text=${encodeURIComponent(readyMessage(d))}` }]]) } : {});
    if (what === "delivered") return sendMessage(chatId, `💵 <b>${h(d.number)}</b> entregada${r.invoice ? ` y cobrada: factura <b>${h(r.invoice.number)}</b> (${usd(r.invoice.total)})` : ""}.`);
    return sendMessage(chatId, `🔧 <b>${h(d.number)}</b> en el taller.`);
  } catch (e) {
    return sendMessage(chatId, `⚠️ ${h((e as Error).message)}`);
  }
}
