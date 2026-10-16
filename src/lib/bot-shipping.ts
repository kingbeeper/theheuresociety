import "server-only";
import { adminDb } from "./supabase";
import { getDoc } from "./documents";
import { addShipment, CARRIERS, markDelivered, shipmentText, trackingUrl, type Carrier, type Shipment } from "./shipping";
import { KIND_LABEL, type Doc } from "./doc-labels";
import { escapeHtml as h, keyboard, sendMessage, tg, type InlineButton } from "./telegram";

// 📦 Envíos por Telegram: añadir el rastreo a un documento y marcar entregados los que van en camino

type Flow = { docId: string; user: string };
const key = (chatId: number) => `tgship:${chatId}`;
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
export const clearShipping = (chatId: number) => adminDb().from("integration_settings").delete().eq("key", key(chatId));

const waButton = (d: Doc, s: Shipment, what: "shipped" | "delivered"): InlineButton[] => {
  const phone = d.client_phone?.replace(/\D/g, "");
  return phone ? [{ text: "📲 Avisar al cliente por WhatsApp", url: `https://wa.me/${phone}?text=${encodeURIComponent(shipmentText(d, s, what))}` }] : [];
};

export async function onShippingText(chatId: number, text: string) {
  const f = await getFlow(chatId);
  if (!f) return false;
  await clearShipping(chatId);
  const d = await getDoc(f.docId);
  if (!d) return sendMessage(chatId, "Ese documento ya no existe.").then(() => true);
  // «FedEx 7712 3456 7890» o solo el número (la paquetería se deduce)
  const m = text.trim().match(/^(fedex|ups|usps|dhl)\b[\s:#-]*(.+)$/i);
  const carrier = m ? m[1].toLowerCase() : null;
  const tracking = (m ? m[2] : text).replace(/\s+/g, "");
  if (tracking.length < 6) {
    await saveFlow(chatId, f);
    return sendMessage(chatId, "Ese número de rastreo parece muy corto. Escríbelo de nuevo, o /cancelar.").then(() => true);
  }
  const { shipment: s, emailed } = await addShipment(d, { carrier, tracking, notify: true }, f.user);
  await sendMessage(
    chatId,
    `📦 <b>Envío añadido</b> · ${KIND_LABEL[d.kind]} ${h(d.number)}\n${CARRIERS[s.carrier]} · <a href="${trackingUrl(s.carrier, s.tracking)}">${h(s.tracking)}</a>\n${emailed ? `✉️ Aviso enviado por correo a ${h(d.client_email ?? "")}` : "Sin aviso por correo (el cliente no tiene correo o no está configurado)."}`,
    { reply_markup: keyboard([waButton(d, s, "shipped"), [{ text: "✅ Marcar entregado", callback_data: `dship:del|${s.id}` }]].filter((r) => r.length)) }
  );
  return true;
}

export async function onShippingCallback(chatId: number, cbId: string, messageId: number, arg: string, user: string) {
  await tg("answerCallbackQuery", { callback_query_id: cbId }).catch(() => {});
  const [what, id] = arg.split("|");
  if (what === "add") {
    const d = await getDoc(id);
    if (!d) return sendMessage(chatId, "Ese documento ya no existe.");
    await saveFlow(chatId, { docId: id, user });
    return sendMessage(chatId, `📦 Envío de ${KIND_LABEL[d.kind]} ${h(d.number)} (${h(d.client_name ?? "")})\nEscribe el número de rastreo (ej. <code>FedEx 7712 3456 7890</code> o solo el número).`, {
      reply_markup: keyboard([[{ text: "✖️ Cancelar", callback_data: "dship:x" }]]),
    });
  }
  if (what === "x") {
    await tg("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: keyboard([]) }).catch(() => {});
    await clearShipping(chatId);
    return sendMessage(chatId, "Cancelado.");
  }
  if (what === "del") {
    await tg("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: keyboard([]) }).catch(() => {});
    const r = await markDelivered(id, true, user);
    if (!r) return sendMessage(chatId, "Ese envío ya no existe.");
    return sendMessage(chatId, `✅ Entregado: ${CARRIERS[r.shipment.carrier as Carrier]} ${h(r.shipment.tracking)}${r.emailed ? "\n✉️ Aviso enviado por correo." : ""}`, {
      ...(r.doc && waButton(r.doc, r.shipment, "delivered").length && { reply_markup: keyboard([waButton(r.doc, r.shipment, "delivered")]) }),
    });
  }
  if (what === "list") {
    const { data } = await adminDb().from("shipments").select("id, carrier, tracking, shipped_at, documents(number, client_name)").eq("status", "shipped").order("shipped_at").limit(25);
    if (!data?.length) return sendMessage(chatId, "✅ No hay envíos en camino.");
    return sendMessage(chatId, `🚚 <b>En camino</b> (${data.length})\n${data.map((s) => {
      const doc = s.documents as unknown as { number: string; client_name: string | null } | null;
      return `• ${CARRIERS[s.carrier as Carrier]} <a href="${trackingUrl(s.carrier, s.tracking)}">${h(s.tracking)}</a> · ${h(doc?.client_name ?? "")} (${h(doc?.number ?? "")})`;
    }).join("\n")}\n\nToca para marcar el que ya llegó:`, {
      reply_markup: keyboard(data.map((s) => [{ text: `✅ ${(s.documents as unknown as { client_name: string | null } | null)?.client_name ?? ""} · ${s.tracking}`.slice(0, 60), callback_data: `dship:del|${s.id}` }])),
    });
  }
}
