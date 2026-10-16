import "server-only";
import { adminDb } from "./supabase";
import { normalizePhone } from "./crm";
import { after } from "next/server";
import { appraiseOffer, askingOf, createOffer, offerSuggestion, OFFER_KIND, type OfferKind } from "./offers";
import { escapeHtml as h, keyboard, sendMessage, tg, type InlineButton } from "./telegram";

// 🤲 «Me ofrecen un reloj» por Telegram: tipo → cliente → reloj → cuánto pide → queda en CRM → Ofertas de clientes

type Flow = { step: "client" | "phone" | "watch" | "asking"; user: string; kind: OfferKind; name?: string; phone?: string | null; watch?: string };
const key = (chatId: number) => `tgofr:${chatId}`;
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
export const clearOffer = (chatId: number) => adminDb().from("integration_settings").delete().eq("key", key(chatId));

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://theheuresociety.vercel.app").replace(/\/$/, "");
const cancel: InlineButton[] = [{ text: "✖️ Cancelar", callback_data: "dofr:x" }];

export function startOffer(chatId: number) {
  return sendMessage(chatId, "🤲 <b>Me ofrecen un reloj</b>\n¿Qué quiere hacer el cliente?", {
    reply_markup: keyboard([
      [{ text: "💵 Me lo vende", callback_data: "dofr:k|sell" }],
      [{ text: "🔁 Lo quiere cambiar", callback_data: "dofr:k|trade" }],
      [{ text: "🤝 Lo deja en consignación", callback_data: "dofr:k|consign" }],
      cancel,
    ]),
  });
}

// «Rolex Submariner 126610LN» → marca, modelo y referencia (la palabra con números es la referencia)
function splitWatch(t: string) {
  const words = t.trim().split(/\s+/);
  const brand = words.shift() ?? "";
  const refIdx = words.findIndex((w) => /\d/.test(w) && w.length >= 4);
  const reference = refIdx >= 0 ? words.splice(refIdx, 1)[0] : null;
  return { brand, model: words.join(" ") || null, reference };
}

async function save(chatId: number, f: Flow, asking: string | null) {
  await clearOffer(chatId);
  const w = splitWatch(f.watch ?? "");
  const r = await createOffer({ kind: f.kind, name: f.name ?? "", phone: f.phone, brand: w.brand, model: w.model, reference: w.reference, asking }, f.user);
  if ("error" in r) return sendMessage(chatId, `⚠️ No pude guardar la oferta: ${h(r.error ?? "")}`);
  return sendMessage(
    chatId,
    `✅ <b>Oferta guardada</b> · ${OFFER_KIND[f.kind]}\n${h(f.watch ?? "")}${asking ? ` · pide ${h(asking)}` : ""}\n${h(f.name ?? "")}${f.phone ? ` · ${f.phone}` : ""}\n\nEstá en CRM → Ofertas de clientes («Nuevas»). Las fotos se añaden ahí.`,
    { reply_markup: keyboard([[{ text: "🔎 Tasar (precio de mercado)", callback_data: `dofr:tas|${r.id}` }], [{ text: "📂 Abrir en el CRM", url: `${SITE}/admin/compras` }]]) }
  );
}

export async function onOfferText(chatId: number, text: string) {
  const f = await getFlow(chatId);
  if (!f) return false;
  if (f.step === "client") {
    // «Nombre +1 305…» o contacto compartido desde la agenda
    const m = text.match(/^(.*?)[\s,]*(\+?\d[\d\s().-]{6,})$/);
    f.name = (m ? m[1] : text).trim().slice(0, 80);
    if (!f.name) return sendMessage(chatId, "Escribe el nombre del cliente.").then(() => true);
    f.phone = m ? normalizePhone(m[2]) : null;
    f.step = f.phone ? "watch" : "phone";
    await saveFlow(chatId, f);
    await sendMessage(
      chatId,
      f.phone ? "⌚ ¿Qué reloj es? (marca, modelo y referencia; ej. <code>Rolex Submariner 126610LN 2021 full set</code>)" : "📱 ¿Su teléfono? (con código de país)",
      { reply_markup: keyboard(f.phone ? [cancel] : [[{ text: "No lo tengo", callback_data: "dofr:nophone" }], cancel]) }
    );
    return true;
  }
  if (f.step === "phone") {
    const phone = normalizePhone(text);
    if (!phone) return sendMessage(chatId, "Ese teléfono no parece válido. Escríbelo con código de país, ej. <code>+1 305 555 1234</code>.").then(() => true);
    f.phone = phone;
    f.step = "watch";
    await saveFlow(chatId, f);
    await sendMessage(chatId, "⌚ ¿Qué reloj es? (marca, modelo y referencia; ej. <code>Rolex Submariner 126610LN 2021 full set</code>)", { reply_markup: keyboard([cancel]) });
    return true;
  }
  if (f.step === "watch") {
    f.watch = text.slice(0, 200);
    f.step = "asking";
    await saveFlow(chatId, f);
    await sendMessage(chatId, "💵 ¿Cuánto pide? (ej. <code>14000</code>)", { reply_markup: keyboard([[{ text: "No lo dijo", callback_data: "dofr:noask" }], cancel]) });
    return true;
  }
  if (f.step === "asking") {
    await save(chatId, f, text.slice(0, 60));
    return true;
  }
  return false;
}

export async function onOfferCallback(chatId: number, cbId: string, messageId: number, arg: string, user: string) {
  await tg("answerCallbackQuery", { callback_query_id: cbId }).catch(() => {});
  await tg("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: keyboard([]) }).catch(() => {});
  const [what, value] = arg.split("|");
  if (what === "x") {
    await clearOffer(chatId);
    return sendMessage(chatId, "Cancelado.");
  }
  if (what === "tas") {
    await sendMessage(chatId, "🔎 Buscando precios en Chrono24, WatchCharts… (≈1 minuto)");
    after(() => appraisalJob(chatId, value));
    return;
  }
  if (what === "k") {
    await saveFlow(chatId, { step: "client", user, kind: (value in OFFER_KIND ? value : "sell") as OfferKind });
    return sendMessage(chatId, "👤 ¿Quién es? Escribe su nombre y teléfono (ej. <code>Juan Pérez +1 305 555 1234</code>) o comparte el contacto (📎 → Contacto).", { reply_markup: keyboard([cancel]) });
  }
  const f = await getFlow(chatId);
  if (!f) return sendMessage(chatId, "Esa oferta ya no está en curso.");
  if (what === "nophone") {
    f.step = "watch";
    await saveFlow(chatId, f);
    return sendMessage(chatId, "⌚ ¿Qué reloj es? (marca, modelo y referencia)", { reply_markup: keyboard([cancel]) });
  }
  if (what === "noask") return save(chatId, f, null);
}

async function appraisalJob(chatId: number, id: string) {
  const m = await appraiseOffer(id).catch(() => null);
  const { data: r } = await adminDb().from("sell_requests").select("kind, brand, model, reference, message").eq("id", id).maybeSingle();
  if (!r) return;
  const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
  const watch = [r.brand, r.model, r.reference].filter(Boolean).join(" ");
  if (!m || (!m.low && !m.typical && !m.high)) return sendMessage(chatId, `🔎 ${h(watch)}: no encontré anuncios comparables.`);
  const s = offerSuggestion(r.kind as string, m.typical);
  const asking = askingOf(r.message as string | null);
  return sendMessage(chatId, [
    `🔎 <b>${h(watch)}</b>`,
    `Mercado: <b>${m.low ? usd(m.low) : "?"} – ${m.high ? usd(m.high) : "?"}</b>${m.typical ? ` · típico ${usd(m.typical)}` : ""}${m.listings ? ` · ${m.listings} anuncios` : ""}`,
    s?.kind === "buy" ? `💵 Ofrecer: ${s.offers.map((o) => `<b>${usd(o.amount)}</b> (${Math.round(o.margin * 100)}%)`).join(" · ")}` : "",
    s?.kind === "consign" ? `🤝 Venderlo a ≈ <b>${usd(s.sellAt)}</b> · al dueño ≈ <b>${usd(s.owner)}</b> (15% para ti)` : "",
    asking && m.typical && r.kind !== "consign" ? `Pide ${usd(asking)}: te dejaría ${Math.round(((m.typical - asking) / m.typical) * 100)}% de margen` : "",
    h(m.note),
  ].filter(Boolean).join("\n"));
}
