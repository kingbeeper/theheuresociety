import "server-only";
import { adminDb } from "./supabase";
import { addEvent, normalizePhone, upsertLead } from "./crm";
import { miamiToUtc, todayInMiami, TIME_ZONE } from "./booking";
import { googleCalendarLink } from "./appointments";
import { parseDate, parseTime } from "./bot-citas";
import { hour12, monthFirst } from "./dates";
import { escapeHtml as h, keyboard, notifyAdmins, sendMessage, tg, type InlineButton } from "./telegram";

// Recordatorios de clientes por Telegram: «un cliente me escribió que le interesa una pieza» →
// cliente → qué quiere → cuándo. A esa hora el bot avisa con lo que quiere y botones para escribirle,
// posponer o marcarlo hecho. También queda como seguimiento del cliente (resumen de las 8:00,
// «Clientes de hoy») y en el calendario de citas.

type RemFlow = {
  step: "client" | "what" | "day" | "time" | "note";
  closeFor?: string; // nota de cierre de este recordatorio
  user: string;
  chatId: number;
  customerId?: string | null;
  name?: string | null;
  phone?: string | null;
  body?: string;
  date?: string;
};

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://theheuresociety.vercel.app").replace(/\/$/, "");
const key = (chatId: number) => `tgrem:${chatId}`;
async function getFlow(chatId: number) {
  const { data } = await adminDb().from("integration_settings").select("value").eq("key", key(chatId)).maybeSingle();
  try {
    return data ? (JSON.parse(data.value as string) as RemFlow) : null;
  } catch {
    return null;
  }
}
const saveFlow = (chatId: number, f: RemFlow) =>
  adminDb().from("integration_settings").upsert({ key: key(chatId), value: JSON.stringify(f), updated_at: new Date().toISOString() }, { onConflict: "key" });
export const clearReminder = (chatId: number) => adminDb().from("integration_settings").delete().eq("key", key(chatId));

const addDays = (iso: string, n: number) => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + n)).toISOString().slice(0, 10);
const dayLabel = (iso: string) => monthFirst(iso);
// «jueves, oct 15 · 3:30 p. m.» (hora de Miami)
const whenLabel = (d: Date, allDay: boolean) => {
  const day = new Intl.DateTimeFormat("sv-SE", { timeZone: TIME_ZONE }).format(d);
  const weekday = new Intl.DateTimeFormat("es-ES", { timeZone: TIME_ZONE, weekday: "long" }).format(d);
  return `${weekday}, ${monthFirst(day, false)}${allDay ? "" : ` · ${hour12(d)}`}`;
};
const rows3 = <T,>(xs: T[]) => xs.reduce<T[][]>((acc, x, i) => (i % 3 ? acc[acc.length - 1].push(x) : acc.push([x]), acc), []);
const miamiTime = (d: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);

// ───────────────────────────── Nuevo recordatorio ─────────────────────────────
export async function startReminder(chatId: number, user: string) {
  await saveFlow(chatId, { step: "client", user, chatId });
  return sendMessage(chatId, "⏰ <b>Nuevo recordatorio</b>\n\n👤 ¿Qué cliente? Escribe nombre y teléfono.\n<i>Ej.: Carlos Méndez 305 555 1234</i>
📎 O compártelo desde tu agenda: clip → <b>Contacto</b>\n\n/cancelar para salir.");
}

async function askWhat(chatId: number, f: RemFlow) {
  f.step = "what";
  await saveFlow(chatId, f);
  return sendMessage(chatId, `📝 ¿Qué quiere <b>${h(f.name ?? "el cliente")}</b>? O qué tienes que hacer.\n<i>Ej.: Busca Daytona panda 126500LN, presupuesto 30k, prefiere con papeles</i>`);
}

async function askDay(chatId: number, f: RemFlow) {
  f.step = "day";
  await saveFlow(chatId, f);
  const today = todayInMiami();
  const opts: [string, string][] = [["Hoy", today], ["Mañana", addDays(today, 1)], ["En 2 días", addDays(today, 2)], ["En 3 días", addDays(today, 3)], ["En 1 semana", addDays(today, 7)], ["En 2 semanas", addDays(today, 14)]];
  return sendMessage(chatId, "📅 ¿Cuándo te lo recuerdo? O escribe la fecha, mes primero (ej. <code>10/25</code>).", { reply_markup: keyboard(rows3(opts.map(([t, d]) => ({ text: t, callback_data: `drem:day|${d}` })))) });
}

async function askTime(chatId: number, f: RemFlow) {
  f.step = "time";
  await saveFlow(chatId, f);
  const times = ["10:00", "12:00", "15:00", "17:00", "19:00"];
  const rows: InlineButton[][] = rows3(times.map((t) => ({ text: hour12(miamiToUtc(f.date!, t)), callback_data: `drem:time|${t}` })));
  if (f.date === todayInMiami()) rows.unshift([{ text: "En 1 hora", callback_data: "drem:time|1h" }, { text: "En 3 horas", callback_data: "drem:time|3h" }]);
  rows.push([{ text: "Sin hora (aviso a las 9:00)", callback_data: "drem:time|-" }]);
  return sendMessage(chatId, `🕒 <b>${h(dayLabel(f.date!))}</b> · ¿a qué hora? O escríbela (ej. <code>4:30 pm</code>; «4:30» sin am/pm es por la tarde).`, { reply_markup: keyboard(rows) });
}

async function save(chatId: number, f: RemFlow, time: string | null) {
  const db = adminDb();
  // Hora: concreta, «en 1/3 horas» o sin hora (aviso a las 9:00 de ese día)
  let due: Date;
  let allDay = false;
  if (time === "1h" || time === "3h") due = new Date(Date.now() + (time === "1h" ? 1 : 3) * 3_600_000);
  else if (time) due = miamiToUtc(f.date!, time);
  else {
    due = miamiToUtc(f.date!, "09:00");
    allDay = true;
  }
  let customerId = f.customerId ?? null;
  if (!customerId) {
    const lead = await upsertLead({ name: f.name ?? null, phone: f.phone ?? null, source: "whatsapp", intent: "buy", interests: f.body ?? null, notify: false });
    customerId = lead.id;
  }
  const { data: r, error } = await db.from("reminders").insert({ customer_id: customerId, body: f.body, due_at: due.toISOString(), all_day: allDay, chat_id: f.chatId, created_by: f.user }).select("id").single();
  await clearReminder(chatId);
  if (error || !r) return sendMessage(chatId, `⚠️ No se pudo guardar el recordatorio: ${h(error?.message ?? "error")}`);
  // Seguimiento del cliente: resumen de las 8:00 y «Clientes de hoy»
  const dueDay = new Intl.DateTimeFormat("sv-SE", { timeZone: TIME_ZONE }).format(due);
  await db.from("customers").update({ follow_up_at: dueDay, follow_up_note: `⏰ ${f.body}`.slice(0, 300), last_activity_at: new Date().toISOString() }).eq("id", customerId);
  await addEvent(customerId, "follow_up", `Recordatorio para el ${whenLabel(due, allDay)}: ${f.body}`, { reminder: r.id }, f.user);
  const link = googleCalendarLink(`⏰ ${f.name ?? "Cliente"}: ${(f.body ?? "").slice(0, 60)}`, dueDay, allDay ? null : miamiTime(due), [f.body, f.phone && `Tel: ${f.phone}`].filter(Boolean).join("\n"));
  return sendMessage(chatId, `✅ <b>Recordatorio guardado</b>\n👤 ${h(f.name ?? "")}${f.phone ? ` · ${h(f.phone)}` : ""}\n📝 ${h(f.body ?? "")}\n⏰ ${h(whenLabel(due, allDay))}${allDay ? " (aviso a las 9:00)" : ""}\n\nTe aviso aquí a esa hora. También sale en tu calendario de citas y en «👥 Clientes de hoy».`, {
    reply_markup: keyboard([
      [{ text: "🔔 Avisarme si entra una pieza así", callback_data: `drem:alert|${r.id}` }],
      [{ text: "📅 Añadir a Google Calendar", url: link }],
    ]),
  });
}

// Respuestas de texto del asistente. Devuelve false si no hay ningún recordatorio a medias.
export async function onReminderText(chatId: number, text: string) {
  const f = await getFlow(chatId);
  if (!f) return false;
  if (f.step === "client") {
    const phoneRaw = text.match(/\+?\d[\d\s().-]{6,}\d/)?.[0] ?? null;
    const name = text.replace(phoneRaw ?? "", "").replace(/[,;·|]+/g, " ").replace(/\s+/g, " ").trim() || null;
    const phone = normalizePhone(phoneRaw);
    if (!name && !phone) return sendMessage(chatId, "Escribe al menos el nombre o el teléfono del cliente.").then(() => true);
    f.name = name;
    f.phone = phone;
    await saveFlow(chatId, f);
    const filters = [phone && `phone.ilike.%${phone.replace(/\D/g, "").slice(-7)}%`, name && name.length > 2 && `name.ilike.%${name.replace(/[,()"%]/g, "")}%`].filter(Boolean).join(",");
    const { data } = filters ? await adminDb().from("customers").select("id, name, phone").or(filters).limit(5) : { data: [] };
    if (data?.length) {
      const rows: InlineButton[][] = data.map((c) => [{ text: `👤 ${c.name ?? "Sin nombre"}${c.phone ? ` · ${c.phone}` : ""}`.slice(0, 60), callback_data: `drem:cli|${c.id}` }]);
      rows.push([{ text: `➕ Nuevo: ${name ?? phone}`.slice(0, 60), callback_data: "drem:cli|new" }]);
      await sendMessage(chatId, "Encontré estos clientes en el CRM. ¿Es alguno?", { reply_markup: keyboard(rows) });
      return true;
    }
    await askWhat(chatId, f);
    return true;
  }
  if (f.step === "what") {
    f.body = text.slice(0, 500);
    await askDay(chatId, f);
    return true;
  }
  if (f.step === "day") {
    const d = parseDate(text);
    if (!d) return sendMessage(chatId, "No entendí la fecha. Escríbela con el mes primero: <code>10/25</code>.").then(() => true);
    f.date = d;
    await askTime(chatId, f);
    return true;
  }
  if (f.step === "note") {
    await clearReminder(chatId);
    if (f.customerId) await addEvent(f.customerId, "note", `Seguimiento: ${text.slice(0, 1000)}`, { reminder: f.closeFor }, f.user);
    await sendMessage(chatId, `📝 Anotado en la ficha de ${h(f.name ?? "el cliente")}.`, {
      reply_markup: keyboard([[{ text: "💬 Hacer cotización", callback_data: `drem:next|${f.closeFor}.quote` }, { text: "⏰ Volver a recordar", callback_data: `drem:next|${f.closeFor}.again` }]]),
    });
    return true;
  }
  if (f.step === "time") {
    const t = parseTime(text);
    if (!t) return sendMessage(chatId, "No entendí la hora. Escríbela así: <code>15:30</code> o <code>3:30 pm</code>.").then(() => true);
    await save(chatId, f, t);
    return true;
  }
  return false;
}

// ───────────────────────────── Avisos ─────────────────────────────
type Reminder = { id: string; body: string; due_at: string; all_day: boolean; chat_id: number | null; customer_id: string | null; customer: { name: string | null; phone: string | null; wa_id: string | null } | null };
const SELECT = "id, body, due_at, all_day, chat_id, customer_id, customer:customers(name, phone, wa_id)";

function reminderCard(r: Reminder, head: string) {
  const c = r.customer;
  const wa = c?.wa_id ?? c?.phone?.replace(/\D/g, "");
  const first = (c?.name ?? "").split(" ")[0];
  const msg = `Hola ${first}, le escribo de The Heure Society por la pieza que le interesaba. ¿Sigue buscándola? Tengo novedades para usted.`;
  const rows: InlineButton[][] = [];
  if (wa) rows.push([{ text: "📲 Escribirle por WhatsApp", url: `https://wa.me/${wa}?text=${encodeURIComponent(msg)}` }]);
  rows.push([{ text: "✅ Hecho", callback_data: `drem:done|${r.id}` }]);
  rows.push([{ text: "⏰ +1 hora", callback_data: `drem:snz|${r.id}.1h` }, { text: "Mañana", callback_data: `drem:snz|${r.id}.1d` }, { text: "En 3 días", callback_data: `drem:snz|${r.id}.3d` }]);
  if (r.customer_id) rows.push([{ text: "Ficha en el CRM", url: `${SITE}/admin/leads/${r.customer_id}` }]);
  const text = `${head}\n👤 <b>${h(c?.name ?? "Cliente")}</b>${c?.phone ? ` · ${h(c.phone)}` : ""}\n📝 ${h(r.body)}\n🕒 ${h(whenLabel(new Date(r.due_at), r.all_day))}`;
  return { text, extra: { reply_markup: keyboard(rows) } };
}

// Pasada de cada 10 minutos: avisa de los recordatorios que ya tocan
export async function sendDueReminders() {
  const db = adminDb();
  const { data } = await db.from("reminders").select(SELECT).is("done_at", null).is("notified_at", null).lte("due_at", new Date().toISOString()).limit(20);
  for (const r of (data ?? []) as unknown as Reminder[]) {
    const { data: locked } = await db.from("reminders").update({ notified_at: new Date().toISOString() }).eq("id", r.id).is("notified_at", null).select("id").maybeSingle();
    if (!locked) continue; // otra pasada ya lo avisó
    const card = reminderCard(r, "⏰ <b>Recordatorio</b>");
    if (r.chat_id) await sendMessage(r.chat_id, card.text, card.extra).catch(() => notifyAdmins(card.text, card.extra));
    else await notifyAdmins(card.text, card.extra);
  }
  return data?.length ?? 0;
}

export async function listReminders(chatId: number) {
  const { data } = await adminDb().from("reminders").select(SELECT).is("done_at", null).order("due_at").limit(25);
  const list = (data ?? []) as unknown as Reminder[];
  const add = [{ text: "➕ Nuevo recordatorio", callback_data: "mrem:new" }];
  if (!list.length) return sendMessage(chatId, "No tienes recordatorios pendientes.", { reply_markup: keyboard([add]) });
  const now = Date.now();
  const fmt = (r: Reminder) => {
    const d = new Date(r.due_at);
    return `${monthFirst(new Intl.DateTimeFormat("sv-SE", { timeZone: TIME_ZONE }).format(d))}${r.all_day ? "" : ` ${hour12(d)}`}`;
  };
  return sendMessage(chatId, `⏰ <b>Recordatorios pendientes</b> (${list.length})\n⚠️ = ya pasó la hora · toca uno para verlo`, {
    reply_markup: keyboard([
      ...list.map((r) => [{ text: `${new Date(r.due_at).getTime() < now ? "⚠️ " : ""}${fmt(r)} · ${r.customer?.name ?? ""} · ${r.body}`.slice(0, 62), callback_data: `drem:show|${r.id}` }]),
      add,
    ]),
  });
}

// ───────────────────────────── Botones ─────────────────────────────
export async function onReminderCallback(chatId: number, cbId: string, messageId: number, arg: string, user: string) {
  const answer = (text?: string) => tg("answerCallbackQuery", { callback_query_id: cbId, ...(text && { text }) }).catch(() => {});
  const clearButtons = () => tg("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: keyboard([]) }).catch(() => {});
  const [what, value] = arg.split("|");
  const db = adminDb();

  // Recordatorio ya guardado
  if (what === "show" || what === "done" || what === "snz" || what === "alert" || what === "next") {
    const [id, by] = value.split(".");
    const { data } = await db.from("reminders").select(SELECT).eq("id", id).maybeSingle();
    const r = data as unknown as Reminder | null;
    if (!r) {
      await answer("Ese recordatorio ya no existe");
      return clearButtons();
    }
    if (what === "show") {
      await answer();
      const card = reminderCard(r, "⏰ <b>Recordatorio</b>");
      return sendMessage(chatId, card.text, card.extra);
    }
    if (what === "done") {
      await answer("Hecho");
      await clearButtons();
      await db.from("reminders").update({ done_at: new Date().toISOString() }).eq("id", id);
      if (r.customer_id) {
        const dueDay = new Intl.DateTimeFormat("sv-SE", { timeZone: TIME_ZONE }).format(new Date(r.due_at));
        await db.from("customers").update({ follow_up_at: null, follow_up_note: null, last_activity_at: new Date().toISOString() }).eq("id", r.customer_id).eq("follow_up_at", dueDay);
        await addEvent(r.customer_id, "follow_up", `Recordatorio hecho: ${r.body}`, { reminder: id }, user);
      }
      // ¿Qué sigue con este cliente?
      return sendMessage(chatId, `✅ <b>Hecho</b> · ${h(r.customer?.name ?? "")}\n📝 ${h(r.body)}\n\n¿Cómo quedó? ¿Qué sigue?`, {
        reply_markup: keyboard([
          [{ text: "💬 Interesado: hacer cotización", callback_data: `drem:next|${id}.quote` }],
          [{ text: "📄 Acepta: hacer proforma", callback_data: `drem:next|${id}.proforma` }, { text: "🧾 Compra ya: factura", callback_data: `drem:next|${id}.invoice` }],
          [{ text: "📅 Agendar cita", callback_data: `drem:next|${id}.cita` }, { text: "⏰ Volver a recordar", callback_data: `drem:next|${id}.again` }],
          [{ text: "📝 Anotar cómo quedó", callback_data: `drem:next|${id}.note` }],
          [{ text: "❌ No le interesa", callback_data: `drem:next|${id}.lost` }, { text: "Nada más", callback_data: `drem:next|${id}.ok` }],
        ]),
      });
    }
    if (what === "next") {
      await clearButtons();
      await answer();
      const c = { customerId: r.customer_id, name: r.customer?.name ?? null, phone: r.customer?.phone ?? null };
      if (by === "quote" || by === "proforma" || by === "invoice") {
        const { startFlow } = await import("./bot-docs");
        return startFlow(chatId, by, "", user, r.customer_id);
      }
      if (by === "cita") return (await import("./bot-citas")).startCitaFor(chatId, user, c);
      if (by === "again") {
        await saveFlow(chatId, { step: "day", user, chatId, customerId: c.customerId, name: c.name, phone: c.phone, body: r.body });
        return askDay(chatId, { step: "day", user, chatId, customerId: c.customerId, name: c.name, phone: c.phone, body: r.body });
      }
      if (by === "note") {
        await saveFlow(chatId, { step: "note", user, chatId, closeFor: r.id, customerId: c.customerId, name: c.name });
        return sendMessage(chatId, "📝 Escribe cómo quedó (ej. «le pareció caro, vuelve en enero»).");
      }
      if (by === "lost") {
        // Pasa a «Perdido»: sale de los leads activos, los seguimientos y la Demanda (la ficha se queda)
        if (r.customer_id) {
          const { data: cust } = await db.from("customers").select("stage").eq("id", r.customer_id).single();
          await db.from("customers").update({ stage: "lost", follow_up_at: null, follow_up_note: null, last_activity_at: new Date().toISOString() }).eq("id", r.customer_id);
          await addEvent(r.customer_id, "stage", `No le interesa: ${r.body} · Etapa: Perdido`, { reminder: r.id, from: cust?.stage, to: "lost" }, user);
          await db.from("watch_alerts").update({ active: false }).eq("customer_id", r.customer_id).eq("query", r.body.slice(0, 120));
          await db.from("reminders").update({ done_at: new Date().toISOString() }).eq("customer_id", r.customer_id).is("done_at", null);
        }
        return sendMessage(chatId, `❌ <b>${h(r.customer?.name ?? "Cliente")}</b> pasa a <b>Perdido</b>. Su ficha y su historial se quedan en el CRM; si vuelve a escribir, se reactiva solo y te aviso.`);
      }
      return sendMessage(chatId, "👍 Cerrado.");
    }
    if (what === "snz") {
      await clearButtons();
      const next = by === "1h" ? new Date(Date.now() + 3_600_000) : new Date(Math.max(Date.now(), new Date(r.due_at).getTime()) + (by === "3d" ? 3 : 1) * 86_400_000);
      await db.from("reminders").update({ due_at: next.toISOString(), notified_at: null }).eq("id", id);
      if (r.customer_id) await db.from("customers").update({ follow_up_at: new Intl.DateTimeFormat("sv-SE", { timeZone: TIME_ZONE }).format(next) }).eq("id", r.customer_id);
      await answer("Pospuesto");
      return sendMessage(chatId, `⏰ Pospuesto al ${h(whenLabel(next, r.all_day && by !== "1h"))}: ${h(r.customer?.name ?? "")} · ${h(r.body)}`);
    }
    // Avisarme si entra una pieza así: búsqueda «avísenme» del cliente (sale también en Demanda)
    await clearButtons();
    if (r.customer_id) {
      const query = r.body.slice(0, 120);
      const { data: exists } = await db.from("watch_alerts").select("id").eq("customer_id", r.customer_id).eq("query", query).maybeSingle();
      if (!exists) await db.from("watch_alerts").insert({ customer_id: r.customer_id, query });
    }
    await answer("Listo");
    return sendMessage(chatId, "🔔 Hecho: si entra al inventario una pieza que encaje, te aviso con los datos de este cliente. También sale en Demanda.");
  }

  // Asistente
  const f = await getFlow(chatId);
  if (!f) {
    await answer("Este recordatorio ya no está en curso");
    return clearButtons();
  }
  await answer();
  await clearButtons();
  if (what === "cli") {
    if (value !== "new") {
      const { data: c } = await db.from("customers").select("id, name, phone").eq("id", value).single();
      f.customerId = c?.id ?? null;
      f.name = c?.name ?? f.name;
      f.phone = c?.phone ?? f.phone;
    }
    return askWhat(chatId, f);
  }
  if (what === "day") {
    f.date = value;
    return askTime(chatId, f);
  }
  if (what === "time") return save(chatId, f, value === "-" ? null : value);
}
