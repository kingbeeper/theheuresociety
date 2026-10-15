import "server-only";
import { adminDb } from "./supabase";
import { normalizePhone } from "./crm";
import { addDealer, answerDealer, askDealers, companyOf, dealerMessage, dealers, requestsOf, REQUEST_STATUS, statsFor, waLink, type DealerRequest } from "./dealers";
import { escapeHtml as h, keyboard, sendMessage, tg, type InlineButton } from "./telegram";

// 🤝 Dealers por Telegram: pedir una pieza (a todos o a uno), ver mis dealers con su historial,
// anotar lo que respondieron y añadir uno nuevo. Todo queda en CRM → Dealers.

type Flow = {
  step: "query" | "budget" | "name" | "phone" | "company" | "price";
  user: string;
  query?: string;
  dealerIds?: string[]; // vacío = todos
  name?: string;
  phone?: string | null;
  reqId?: string;
};
const key = (chatId: number) => `tgdl:${chatId}`;
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
export const clearDealerFlow = (chatId: number) => adminDb().from("integration_settings").delete().eq("key", key(chatId));

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://theheuresociety.vercel.app").replace(/\/$/, "");
const usd = (n: number | string) => `$${Math.round(Number(n)).toLocaleString("en-US")}`;
const cancel: InlineButton[] = [{ text: "✖️ Cancelar", callback_data: "ddl:x" }];

// «28500», «28,500», «28.5k», «$28500 2024 full set» → precio y el resto como nota
function priceAndNote(t: string) {
  const m = t.trim().match(/^\$?\s*(\d[\d.,]*)\s*(k)?\b\s*(.*)$/i);
  if (!m) return null;
  const n = Number(m[2] ? m[1].replace(",", ".") : m[1].replace(/[.,](?=\d{3}\b)/g, "").replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return null;
  return { price: Math.round(m[2] ? n * 1000 : n), note: m[3]?.trim() || null };
}

export function dealersMenu(chatId: number) {
  return sendMessage(chatId, "🤝 <b>Dealers</b>", {
    reply_markup: keyboard([
      [{ text: "🔎 Pedir una pieza a mis dealers", callback_data: "ddl:ask" }],
      [{ text: "⏳ Sin respuesta (anotar lo que dijeron)", callback_data: "ddl:open" }],
      [{ text: "📋 Mis dealers", callback_data: "ddl:list" }, { text: "➕ Nuevo dealer", callback_data: "ddl:new" }],
    ]),
  });
}

async function startAsk(chatId: number, user: string, dealerIds: string[] = []) {
  await saveFlow(chatId, { step: "query", user, dealerIds });
  return sendMessage(chatId, "🔎 ¿Qué reloj buscas?\n<i>Ej.: Rolex Daytona 126500LN blanco, 2023+, full set</i>", { reply_markup: keyboard([cancel]) });
}

// Registra el pedido y manda un botón de WhatsApp por dealer, con el mensaje ya escrito
async function sendAsk(chatId: number, f: Flow, budget: number | null) {
  await clearDealerFlow(chatId);
  const all = (await dealers()).filter((x) => x.wa_id || x.phone);
  const list = f.dealerIds?.length ? all.filter((x) => f.dealerIds!.includes(x.id)) : all;
  if (!list.length) return sendMessage(chatId, "No tienes dealers con teléfono. Añade uno con «➕ Nuevo dealer».", { reply_markup: keyboard([[{ text: "➕ Nuevo dealer", callback_data: "ddl:new" }]]) });
  const query = f.query ?? "";
  await askDealers(query, budget, list.map((x) => x.id), null, f.user);
  const rows = list.slice(0, 30).map((x) => [{ text: `📲 ${x.name ?? x.phone ?? "Dealer"}`.slice(0, 60), url: waLink(x, dealerMessage(query, budget, x.name))! }]);
  return sendMessage(chatId, `🤝 <b>Pedido a ${list.length} dealer(s)</b>: ${h(query)}${budget ? ` · hasta ${usd(budget)}` : ""}\nToca cada uno para enviarle el mensaje por WhatsApp. Cuando contesten, anótalo en 🤝 Dealers → ⏳ Sin respuesta.`, { reply_markup: keyboard(rows) });
}

async function listDealers(chatId: number) {
  const list = await dealers();
  if (!list.length) return sendMessage(chatId, "Aún no tienes dealers.", { reply_markup: keyboard([[{ text: "➕ Nuevo dealer", callback_data: "ddl:new" }]]) });
  const { data } = await adminDb().from("dealer_requests").select("dealer_id, status").in("dealer_id", list.map((d) => d.id));
  const count = (id: string) => (data ?? []).filter((r) => r.dealer_id === id);
  return sendMessage(chatId, `📋 <b>Mis dealers</b> (${list.length})\nToca uno para ver su historial.`, {
    reply_markup: keyboard(list.slice(0, 40).map((d) => {
      const rs = count(d.id);
      const has = rs.filter((r) => r.status === "has" || r.status === "offered").length;
      return [{ text: `${d.name ?? d.phone ?? "Dealer"}${rs.length ? ` · ${has}/${rs.length} la tenía` : ""}`.slice(0, 60), callback_data: `ddl:see|${d.id}` }];
    })),
  });
}

async function showDealer(chatId: number, id: string) {
  const { data: d } = await adminDb().from("customers").select("id, name, phone, wa_id, email, notes").eq("id", id).maybeSingle();
  if (!d) return sendMessage(chatId, "Ese dealer ya no existe.");
  const reqs = await requestsOf(id, 50);
  const s = statsFor(reqs);
  const company = companyOf(d.notes);
  const wa = waLink(d, "");
  const lines = [
    `🤝 <b>${h(d.name ?? "Dealer")}</b>${company ? ` · ${h(company)}` : ""}`,
    [d.phone, d.email].filter(Boolean).map((x) => h(x!)).join(" · "),
    "",
    s.asked ? `Pedidos: <b>${s.asked}</b> · respondió ${Math.round((s.answered / s.asked) * 100)}% · la tenía ${s.has}${s.best ? `\nMejor oferta: <b>${usd(s.best.price!)}</b> (${h(s.best.query)})` : ""}` : "Todavía no se le ha pedido nada.",
    ...(reqs.length ? ["", "<b>Últimos pedidos</b>", ...reqs.slice(0, 8).map((r) => `• ${h(r.query)} — ${REQUEST_STATUS[r.status]}${r.price ? ` ${usd(r.price)}` : ""}${r.note ? ` · ${h(r.note)}` : ""} <i>(${new Date(r.asked_at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" })})</i>`)] : []),
  ].filter((x) => x !== undefined);
  return sendMessage(chatId, lines.join("\n"), {
    reply_markup: keyboard([
      [{ text: "🔎 Pedirle una pieza", callback_data: `ddl:ask1|${d.id}` }],
      ...(wa ? [[{ text: "📲 WhatsApp", url: wa.replace(/\?text=$/, "") }]] : []),
      [{ text: "📂 Ver en el CRM", url: `${SITE}/admin/dealers/${d.id}` }],
    ]),
  });
}

async function listOpen(chatId: number) {
  const { data } = await adminDb().from("dealer_requests").select("*").eq("status", "asked").order("asked_at", { ascending: false }).limit(30);
  const reqs = (data ?? []) as DealerRequest[];
  if (!reqs.length) return sendMessage(chatId, "✅ No hay pedidos sin respuesta.");
  const names = new Map((await dealers()).map((d) => [d.id, d.name ?? d.phone ?? "Dealer"]));
  return sendMessage(chatId, `⏳ <b>Sin respuesta</b> (${reqs.length})\nToca uno para anotar lo que te contestó.`, {
    reply_markup: keyboard(reqs.map((r) => [{ text: `${names.get(r.dealer_id) ?? "Dealer"} · ${r.query}`.slice(0, 60), callback_data: `ddl:r|${r.id}` }])),
  });
}

async function saveNewDealer(chatId: number, f: Flow, company: string | null) {
  await clearDealerFlow(chatId);
  const c = await addDealer({ name: f.name ?? "", phone: f.phone ?? null, company }, f.user);
  return sendMessage(chatId, `✅ <b>${h(c.name ?? f.name ?? "")}</b> ya está en tus dealers${company ? ` (${h(company)})` : ""}.`, {
    reply_markup: keyboard([[{ text: "🔎 Pedirle una pieza", callback_data: `ddl:ask1|${c.id}` }], [{ text: "📋 Mis dealers", callback_data: "ddl:list" }]]),
  });
}

export async function onDealerText(chatId: number, text: string) {
  const f = await getFlow(chatId);
  if (!f) return false;
  if (f.step === "query") {
    f.query = text.slice(0, 200);
    f.step = "budget";
    await saveFlow(chatId, f);
    await sendMessage(chatId, "💵 ¿Presupuesto? (ej. <code>30000</code>)", { reply_markup: keyboard([[{ text: "Sin presupuesto", callback_data: "ddl:nob" }], cancel]) });
    return true;
  }
  if (f.step === "budget") {
    const p = priceAndNote(text);
    if (!p) return sendMessage(chatId, "No entendí el presupuesto. Escribe un número, ej. <code>30000</code>, o pulsa «Sin presupuesto».").then(() => true);
    await sendAsk(chatId, f, p.price);
    return true;
  }
  if (f.step === "name") {
    // «Nombre +1 305…» escrito o contacto compartido de la agenda
    const m = text.match(/^(.*?)[\s,]*(\+?[\d][\d\s().-]{6,})$/);
    f.name = (m ? m[1] : text).trim().slice(0, 80);
    if (!f.name) return sendMessage(chatId, "Escribe el nombre del dealer.").then(() => true);
    const phone = m ? normalizePhone(m[2]) : null;
    if (phone) {
      f.phone = phone;
      f.step = "company";
      await saveFlow(chatId, f);
      await sendMessage(chatId, `🏢 ¿De qué empresa es ${h(f.name)}?`, { reply_markup: keyboard([[{ text: "Sin empresa", callback_data: "ddl:noco" }], cancel]) });
    } else {
      f.step = "phone";
      await saveFlow(chatId, f);
      await sendMessage(chatId, `📱 ¿Su WhatsApp? (con código de país, ej. <code>+1 305 555 1234</code>)`, { reply_markup: keyboard([cancel]) });
    }
    return true;
  }
  if (f.step === "phone") {
    const phone = normalizePhone(text);
    if (!phone) return sendMessage(chatId, "Ese teléfono no parece válido. Escríbelo con código de país, ej. <code>+1 305 555 1234</code>.").then(() => true);
    f.phone = phone;
    f.step = "company";
    await saveFlow(chatId, f);
    await sendMessage(chatId, `🏢 ¿De qué empresa es ${h(f.name ?? "")}?`, { reply_markup: keyboard([[{ text: "Sin empresa", callback_data: "ddl:noco" }], cancel]) });
    return true;
  }
  if (f.step === "company") {
    await saveNewDealer(chatId, f, text.slice(0, 80));
    return true;
  }
  if (f.step === "price") {
    const p = priceAndNote(text);
    if (!p) return sendMessage(chatId, "Escribe el precio (ej. <code>28500 2024 full set</code>) o pulsa «Sin precio».").then(() => true);
    await clearDealerFlow(chatId);
    await answerDealer(f.reqId!, "offered", p.price, p.note, f.user);
    await sendMessage(chatId, `✅ Anotado: la tiene a <b>${usd(p.price)}</b>${p.note ? ` · ${h(p.note)}` : ""}.`, { reply_markup: keyboard([[{ text: "⏳ Más sin respuesta", callback_data: "ddl:open" }]]) });
    return true;
  }
  return false;
}

export async function onDealerCallback(chatId: number, cbId: string, messageId: number, arg: string, user: string) {
  await tg("answerCallbackQuery", { callback_query_id: cbId }).catch(() => {});
  const clearButtons = () => tg("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: keyboard([]) }).catch(() => {});
  const [what, id] = arg.split("|");
  switch (what) {
    case "x":
      await clearButtons();
      await clearDealerFlow(chatId);
      return sendMessage(chatId, "Cancelado.");
    case "ask":
      await clearButtons();
      return startAsk(chatId, user);
    case "ask1":
      return startAsk(chatId, user, [id]);
    case "nob": {
      await clearButtons();
      const f = await getFlow(chatId);
      if (!f || f.step !== "budget") return sendMessage(chatId, "Ese pedido ya no está en curso.");
      return sendAsk(chatId, f, null);
    }
    case "list":
      return listDealers(chatId);
    case "see":
      return showDealer(chatId, id);
    case "open":
      return listOpen(chatId);
    case "new":
      await clearButtons();
      await saveFlow(chatId, { step: "name", user });
      return sendMessage(chatId, "➕ <b>Nuevo dealer</b>\nEscribe su nombre y WhatsApp (ej. <code>Carlos Pérez +1 305 555 1234</code>), o comparte el contacto desde tu agenda (📎 → Contacto).", { reply_markup: keyboard([cancel]) });
    case "noco": {
      await clearButtons();
      const f = await getFlow(chatId);
      if (!f || f.step !== "company") return sendMessage(chatId, "Ese dealer ya no está en curso.");
      return saveNewDealer(chatId, f, null);
    }
    // Anotar la respuesta de un pedido
    case "r": {
      const { data: r } = await adminDb().from("dealer_requests").select("id, query, dealer_id, status").eq("id", id).maybeSingle();
      if (!r) return sendMessage(chatId, "Ese pedido ya no existe.");
      const { data: d } = await adminDb().from("customers").select("name").eq("id", r.dealer_id).maybeSingle();
      return sendMessage(chatId, `¿Qué respondió <b>${h(d?.name ?? "el dealer")}</b> sobre «${h(r.query)}»?`, {
        reply_markup: keyboard([[{ text: "✅ La tiene", callback_data: `ddl:has|${r.id}` }, { text: "❌ No la tiene", callback_data: `ddl:no|${r.id}` }]]),
      });
    }
    case "no":
      await clearButtons();
      await answerDealer(id, "no", null, null, user);
      return sendMessage(chatId, "Anotado: no la tiene.", { reply_markup: keyboard([[{ text: "⏳ Más sin respuesta", callback_data: "ddl:open" }]]) });
    case "has":
      await clearButtons();
      await saveFlow(chatId, { step: "price", user, reqId: id });
      return sendMessage(chatId, "💵 ¿A qué precio? Puedes añadir detalles detrás (ej. <code>28500 2024 full set</code>).", { reply_markup: keyboard([[{ text: "Sin precio todavía", callback_data: `ddl:np|${id}` }], cancel]) });
    case "np":
      await clearButtons();
      await clearDealerFlow(chatId);
      await answerDealer(id, "has", null, null, user);
      return sendMessage(chatId, "Anotado: la tiene (sin precio todavía).", { reply_markup: keyboard([[{ text: "⏳ Más sin respuesta", callback_data: "ddl:open" }]]) });
  }
}
