import "server-only";
import { adminDb } from "./supabase";
import { upsertLead } from "./crm";
import { depositReceived, getDoc, getDocSettings, insertDoc, issueDoc, refundDeposit } from "./documents";
import { depositPct, suggestedDeposit, termsFor, usd } from "./doc-labels";
import { PAYMENT } from "./stock-labels";
import { todayInMiami } from "./booking";
import { SITE_URL } from "./seo";
import { escapeHtml as h, keyboard, sendMessage, tg } from "./telegram";

// Encargos con anticipo por Telegram: qué reloj busca el cliente → cliente → precio máximo →
// anticipo (sugerido según el precio) → plazo → se crea, se marca firmado y llega el PDF con el enlace.

type SourcingFlow = {
  step: "watch" | "client" | "price" | "deposit" | "days" | "confirm";
  user: string;
  title?: string;
  details?: string | null;
  name?: string;
  phone?: string | null;
  price?: number;
  deposit?: number;
  days?: number;
  lang: "en" | "es";
};

const key = (chatId: number) => `tgsrc:${chatId}`;
async function getFlow(chatId: number) {
  const { data } = await adminDb().from("integration_settings").select("value").eq("key", key(chatId)).maybeSingle();
  try {
    return data ? (JSON.parse(data.value as string) as SourcingFlow) : null;
  } catch {
    return null;
  }
}
const saveFlow = (chatId: number, f: SourcingFlow) =>
  adminDb().from("integration_settings").upsert({ key: key(chatId), value: JSON.stringify(f), updated_at: new Date().toISOString() }, { onConflict: "key" });
export const clearSourcing = (chatId: number) => adminDb().from("integration_settings").delete().eq("key", key(chatId));

// «25k», «25,000», «$25.000» → 25000
const amount = (t: string) => {
  const m = t.toLowerCase().replace(/[$\s]/g, "").match(/^(\d+(?:[.,]\d+)*)(k)?$/);
  if (!m) return null;
  const n = Number(m[2] ? m[1].replace(",", ".") : m[1].replace(/[.,](?=\d{3}\b)/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.round((m[2] ? n * 1000 : n) * 100) / 100 : null;
};

export async function startSourcing(chatId: number, user: string) {
  await saveFlow(chatId, { step: "watch", user, lang: "en" });
  return sendMessage(
    chatId,
    "🔎 <b>Nuevo encargo con anticipo</b>\n\n⌚ ¿Qué reloj busca el cliente?\nMarca, modelo y referencia; después de una coma, los detalles.\n<i>Ej.: Rolex Daytona 126500LN, esfera blanca, 2023 o más nuevo, caja y papeles</i>\n\n/cancelar para salir."
  );
}

function askDeposit(chatId: number, f: SourcingFlow) {
  const s = suggestedDeposit(f.price ?? 0);
  return sendMessage(chatId, `💵 ¿Cuánto deja de <b>anticipo</b>?\nSugerido para ${usd(f.price ?? 0)}: <b>${usd(s)}</b> (${depositPct(f.price ?? 0)} %). Escribe otra cantidad si es distinta.`, {
    reply_markup: keyboard([[{ text: `Usar ${usd(s)}`, callback_data: `dsx:dep|${s}` }]]),
  });
}

function summary(chatId: number, f: SourcingFlow) {
  return sendMessage(
    chatId,
    [
      "🔎 <b>Encargo</b> · revisa antes de crearlo",
      "",
      `⌚ <b>${h(f.title ?? "")}</b>${f.details ? `\n${h(f.details)}` : ""}`,
      `👤 ${h(f.name ?? "")}${f.phone ? ` · ${h(f.phone)}` : ""}`,
      `💰 Precio hasta <b>${usd(f.price ?? 0)}</b>`,
      `💵 Anticipo <b>${usd(f.deposit ?? 0)}</b> (reembolsable si no se consigue)`,
      `📅 Plazo de búsqueda: ${f.days} días`,
      `🌐 Documento en ${f.lang === "es" ? "español" : "inglés"}`,
    ].join("\n"),
    {
      reply_markup: keyboard([
        [{ text: "✅ Crear y enviar", callback_data: "dsx:ok|1" }],
        [{ text: f.lang === "es" ? "🇺🇸 En inglés" : "🇪🇸 En español", callback_data: `dsx:lang|${f.lang === "es" ? "en" : "es"}` }, { text: "❌ Cancelar", callback_data: "dsx:no|1" }],
      ]),
    }
  );
}

// Respuestas de texto mientras hay un encargo a medias. Devuelve false si no hay ninguno.
export async function onSourcingText(chatId: number, text: string) {
  const f = await getFlow(chatId);
  if (!f) return false;
  if (f.step === "watch") {
    const [title, ...rest] = text.split(",");
    f.title = title.trim().slice(0, 200);
    f.details = rest.join(",").trim().slice(0, 500) || null;
    f.step = "client";
    await saveFlow(chatId, f);
    await sendMessage(chatId, "👤 ¿Para qué cliente? Nombre y teléfono.\n<i>Ej.: Carlos Méndez 305 555 1234</i>");
    return true;
  }
  if (f.step === "client") {
    const phone = text.match(/\+?[\d\s().-]{7,}/)?.[0]?.trim() ?? null;
    f.name = text.replace(phone ?? "", "").replace(/[·,-]+\s*$/, "").trim() || text.trim();
    f.phone = phone;
    f.step = "price";
    await saveFlow(chatId, f);
    await sendMessage(chatId, "💰 ¿Precio <b>máximo</b> acordado con el cliente? (ej. <code>32000</code> o <code>32k</code>)");
    return true;
  }
  if (f.step === "price") {
    const n = amount(text);
    if (!n) return sendMessage(chatId, "No entendí el precio. Escribe un número, por ejemplo <code>32000</code>.").then(() => true);
    f.price = n;
    f.step = "deposit";
    await saveFlow(chatId, f);
    await askDeposit(chatId, f);
    return true;
  }
  if (f.step === "deposit") {
    const n = amount(text);
    if (!n) return sendMessage(chatId, "No entendí la cantidad. Escribe un número, por ejemplo <code>5000</code>.").then(() => true);
    return setDeposit(chatId, f, n).then(() => true);
  }
  await sendMessage(chatId, "Usa los botones de arriba, o /cancelar para salir.");
  return true;
}

async function setDeposit(chatId: number, f: SourcingFlow, n: number) {
  f.deposit = n;
  f.step = "days";
  await saveFlow(chatId, f);
  return sendMessage(chatId, "📅 ¿Plazo de búsqueda?", {
    reply_markup: keyboard([[30, 60, 90].map((d) => ({ text: `${d} días`, callback_data: `dsx:days|${d}` }))]),
  });
}

async function create(chatId: number, f: SourcingFlow) {
  await clearSourcing(chatId);
  const settings = await getDocSettings();
  const customer = await upsertLead({ name: f.name ?? null, phone: f.phone ?? null, source: "walk_in", intent: "buy", notify: false });
  const today = todayInMiami();
  const due = new Date(new Date(`${today}T12:00:00Z`).getTime() + (f.days ?? 60) * 86_400_000).toISOString().slice(0, 10);
  const d = await insertDoc({
    kind: "sourcing",
    customer_id: customer.id,
    client_name: f.name ?? null,
    client_phone: f.phone ?? null,
    lang: f.lang,
    issue_date: today,
    due_date: due,
    items: [{ title: f.title ?? "", details: f.details ?? null, qty: 1, price: f.price ?? 0 }],
    deposit: f.deposit ?? 0,
    show_serial: false,
    terms: termsFor("sourcing", f.lang, settings),
    created_by: f.user,
  });
  await issueDoc(d, f.user);
  const { deliver } = await import("./bot-docs");
  return deliver(chatId, { ...d, status: "sent" });
}

// Botones: los del asistente (dsx) y los de un encargo ya creado (dsdp, dsdm, dsrf)
export async function onSourcingCallback(chatId: number, cbId: string, messageId: number, action: string, arg: string, user: string) {
  const answer = (text?: string) => tg("answerCallbackQuery", { callback_query_id: cbId, ...(text && { text }) }).catch(() => {});
  const clearButtons = () => tg("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: keyboard([]) }).catch(() => {});

  if (action === "dsx") {
    const f = await getFlow(chatId);
    const [what, value] = arg.split("|");
    if (!f) {
      await answer("Ese encargo ya no está en curso");
      return clearButtons();
    }
    await answer();
    if (what === "dep") {
      await clearButtons();
      return setDeposit(chatId, f, Number(value));
    }
    if (what === "days") {
      await clearButtons();
      f.days = Number(value);
      f.step = "confirm";
      await saveFlow(chatId, f);
      return summary(chatId, f);
    }
    if (what === "lang") {
      await clearButtons();
      f.lang = value === "es" ? "es" : "en";
      await saveFlow(chatId, f);
      return summary(chatId, f);
    }
    if (what === "no") {
      await clearButtons();
      await clearSourcing(chatId);
      return sendMessage(chatId, "Encargo cancelado.");
    }
    if (what === "ok") {
      await clearButtons();
      await sendMessage(chatId, "⏳ Creando el encargo y el PDF…");
      return create(chatId, f);
    }
    return;
  }

  const [id, extra] = arg.split("|");
  const d = await getDoc(id);
  if (!d || d.kind !== "sourcing" || d.status !== "sent") {
    await answer("Este encargo ya está cerrado.");
    return clearButtons();
  }
  // Anticipo recibido: primero la forma de pago
  if (action === "dsdp") {
    if (d.deposit_paid_at) return answer("El anticipo ya consta como recibido");
    await answer();
    const methods = Object.values(PAYMENT);
    return sendMessage(chatId, `💵 ¿Cómo pagó el anticipo de ${usd(d.deposit ?? 0)}?`, {
      reply_markup: keyboard(methods.map((m, i) => [{ text: m, callback_data: `dsdm:${d.id}|${i}` }])),
    });
  }
  if (action === "dsdm") {
    if (d.deposit_paid_at) return answer("El anticipo ya consta como recibido");
    await clearButtons();
    await depositReceived(d, Object.values(PAYMENT)[Number(extra)] ?? null, todayInMiami(), user);
    await answer("Anticipo registrado");
    return sendMessage(chatId, `✅ Anticipo de <b>${usd(d.deposit ?? 0)}</b> registrado en ${h(d.number)}. Ya estás buscando: te aviso si entra al inventario un reloj que encaje.`);
  }
  if (action === "dsrf") {
    if (extra !== "ok") {
      await answer();
      return sendMessage(chatId, `↩️ ¿Cerrar ${h(d.number)} sin conseguir el reloj?${d.deposit_paid_at ? `\nQueda registrado que se le <b>devuelve el anticipo de ${usd(d.deposit ?? 0)}</b>.` : ""}`, {
        reply_markup: keyboard([[{ text: "Sí, cerrar y devolver", callback_data: `dsrf:${d.id}|ok` }]]),
      });
    }
    await clearButtons();
    await refundDeposit(d, user);
    await answer("Encargo cerrado");
    return sendMessage(chatId, `↩️ ${h(d.number)} cerrado.${d.deposit_paid_at ? ` Recuerda devolver <b>${usd(d.deposit ?? 0)}</b> a ${h(d.client_name ?? "el cliente")}.` : ""}`);
  }
}

export const SOURCING_ACTIONS = new Set(["dsx", "dsdp", "dsdm", "dsrf"]);

// Botones de un encargo abierto (en el PDF que llega por Telegram)
export const sourcingButtons = (d: { id: string; deposit_paid_at?: string | null }) => [
  ...(!d.deposit_paid_at ? [[{ text: "💵 Anticipo recibido", callback_data: `dsdp:${d.id}` }]] : []),
  [{ text: "✅ Conseguido: facturar (en el CRM)", url: `${SITE_URL}/admin/documentos/${d.id}` }],
  [{ text: "↩️ No se consiguió: cerrar", callback_data: `dsrf:${d.id}` }],
];
