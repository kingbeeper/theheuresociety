import "server-only";
import { adminDb } from "./supabase";
import { booking } from "./site";
import { addEvent, normalizePhone } from "./crm";
import { clashes, miamiToUtc, slotClash, todayInMiami, TIME_ZONE } from "./booking";
import { hour12, monthFirst } from "./dates";
import { addAppointment, addFollowupNote, clashText, followupAppointment, followupsFor, OUTCOME_LABEL, scheduleCall, setOutcome, whenText } from "./appointments";
import { escapeHtml as h, keyboard, sendMessage, tg, type InlineButton } from "./telegram";

// Citas por Telegram: agendar (cliente → día → hora → oficina o video → nota), ver las de hoy y de la
// semana, confirmar, cambiar de hora o cancelar, y el seguimiento de cada cita (resultado, notas,
// llamadas y otra cita para el mismo cliente). Usa la misma lógica que el CRM (lib/appointments).

type CitaFlow = {
  step: "client" | "day" | "time" | "kind" | "note" | "confirm" | "fnote" | "fctime" | "fcall";
  user: string;
  rescheduleId?: string; // cambiando la hora de una cita existente
  noteFor?: string; // nota de seguimiento de esta cita
  callFor?: string; // recordatorio de seguimiento de esta cita (día → hora → para qué)
  callNote?: string; // nota propuesta (p. ej. «artículo enviado: ver si respondió»)
  nextFor?: string; // otra cita para el mismo cliente, que sale de esta
  customerId?: string | null;
  name?: string | null;
  phone?: string | null;
  date?: string;
  time?: string;
  kind?: "office" | "video";
  note?: string | null;
};

const key = (chatId: number) => `tgcita:${chatId}`;
async function getFlow(chatId: number) {
  const { data } = await adminDb().from("integration_settings").select("value").eq("key", key(chatId)).maybeSingle();
  try {
    return data ? (JSON.parse(data.value as string) as CitaFlow) : null;
  } catch {
    return null;
  }
}
const saveFlow = (chatId: number, f: CitaFlow) =>
  adminDb().from("integration_settings").upsert({ key: key(chatId), value: JSON.stringify(f), updated_at: new Date().toISOString() }, { onConflict: "key" });
export const clearCita = (chatId: number) => adminDb().from("integration_settings").delete().eq("key", key(chatId));

const addDays = (iso: string, n: number) => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + n)).toISOString().slice(0, 10);
// Mes primero: «oct 25 · dom»
const dayLabel = (iso: string) => monthFirst(iso);
const timeLabel = (d: Date) => hour12(d);
const rows3 = <T,>(xs: T[]) => xs.reduce<T[][]>((acc, x, i) => (i % 3 ? acc[acc.length - 1].push(x) : acc.push([x]), acc), []);

// ───────────────────────────── Agendar ─────────────────────────────
export async function startCita(chatId: number, user: string) {
  await saveFlow(chatId, { step: "client", user });
  return sendMessage(chatId, "📅 <b>Nueva cita</b>\n\n👤 ¿Para quién? Escribe nombre y teléfono.\n<i>Ej.: Carlos Méndez 305 555 1234</i>
📎 O compártelo desde tu agenda: clip → <b>Contacto</b>\n\n/cancelar para salir.");
}

async function askDay(chatId: number, f: CitaFlow) {
  f.step = "day";
  await saveFlow(chatId, f);
  const today = todayInMiami();
  const days = Array.from({ length: 9 }, (_, i) => addDays(today, i));
  const buttons = days.map((d, i) => ({ text: i === 0 ? "Hoy" : i === 1 ? "Mañana" : dayLabel(d), callback_data: `dapt:day|${d}` }));
  const q = f.callFor ? "🔔 ¿Qué día le das seguimiento?" : f.nextFor ? "📅 ¿Qué día es la nueva cita?" : `📆 ¿Qué día${f.rescheduleId ? " es ahora" : ""}?`;
  return sendMessage(chatId, `${q} O escribe la fecha, mes primero (ej. <code>10/25</code>).`, { reply_markup: keyboard(rows3(buttons)) });
}

async function askTime(chatId: number, f: CitaFlow) {
  f.step = "time";
  await saveFlow(chatId, f);
  const date = f.date!;
  const { data } = await adminDb()
    .from("appointments")
    .select("id, starts_at")
    .in("status", ["requested", "confirmed"])
    .gte("starts_at", miamiToUtc(date, "00:00").toISOString())
    .lt("starts_at", miamiToUtc(addDays(date, 1), "00:00").toISOString());
  // Al cambiar de hora, la propia cita no cuenta como ocupada
  const taken = (data ?? []).filter((r) => r.id !== f.rescheduleId).map((r) => new Date(r.starts_at as string));
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  const now = Date.now();
  const free = ((booking.slots as Record<number, string[]>)[weekday] ?? []).filter((t) => !clashes(miamiToUtc(date, t), taken) && miamiToUtc(date, t).getTime() > now);
  const busy = taken.length ? `\nYa hay ${taken.length} cita(s) ese día: ${taken.map(timeLabel).join(", ")}.` : "";
  return sendMessage(
    chatId,
    `🕒 <b>${h(dayLabel(date))}</b> · ¿a qué hora?${free.length ? "" : "\nEse día no queda ningún hueco del horario habitual."}${busy}\nO escribe otra hora (ej. <code>15:30</code> o <code>3:30 pm</code>).`,
    free.length ? { reply_markup: keyboard(rows3(free.map((t) => ({ text: hour12(miamiToUtc(date, t)), callback_data: `dapt:time|${t}` })))) } : {}
  );
}

async function askKind(chatId: number, f: CitaFlow) {
  f.step = "kind";
  await saveFlow(chatId, f);
  return sendMessage(chatId, "¿Dónde?", { reply_markup: keyboard([[{ text: "🏛 En la oficina", callback_data: "dapt:kind|office" }, { text: "🎥 Videollamada", callback_data: "dapt:kind|video" }]]) });
}

async function askNote(chatId: number, f: CitaFlow) {
  f.step = "note";
  await saveFlow(chatId, f);
  return sendMessage(chatId, "📝 ¿Alguna nota? (qué reloj quiere ver, si viene acompañado…)", { reply_markup: keyboard([[{ text: "Sin nota", callback_data: "dapt:note|-" }]]) });
}

async function summary(chatId: number, f: CitaFlow) {
  f.step = "confirm";
  await saveFlow(chatId, f);
  const start = miamiToUtc(f.date!, f.time!);
  return sendMessage(
    chatId,
    [`📅 <b>Revisa la cita</b>`, "", `👤 ${h(f.name ?? "")}${f.phone ? ` · ${h(f.phone)}` : ""}`, `🕒 <b>${h(whenText(start))}</b>`, f.kind === "video" ? "🎥 Videollamada" : "🏛 En la oficina", f.note ? `📝 ${h(f.note)}` : ""].filter(Boolean).join("\n"),
    {
      reply_markup: keyboard([
        [{ text: "✅ Agendar (confirmada)", callback_data: "dapt:ok|1" }],
        [{ text: "🕓 Agendar como pendiente", callback_data: "dapt:ok|0" }, { text: "❌ Cancelar", callback_data: "dapt:no|1" }],
      ]),
    }
  );
}

async function create(chatId: number, f: CitaFlow, confirmed: boolean, force = false) {
  const n = { source: "walk_in", date: f.date!, time: f.time!, kind: f.kind ?? "office", note: f.note, confirmed, force, via: "Telegram" } as const;
  // Si sale del seguimiento de otra cita, queda enlazada a ella
  const r = f.nextFor ? await followupAppointment(f.nextFor, n, f.user) : await addAppointment({ ...n, customerId: f.customerId, name: f.name, phone: f.phone }, f.user);
  if ("error" in r) {
    if (r.clash) return sendMessage(chatId, `⚠️ ${h(r.error)}`, { reply_markup: keyboard([[{ text: "Agendar igual", callback_data: `dapt:force|${confirmed ? 1 : 0}` }, { text: "Elegir otra hora", callback_data: "dapt:retime|1" }]]) });
    await clearCita(chatId);
    return sendMessage(chatId, `⚠️ No se pudo agendar: ${h(r.error)}`);
  }
  await clearCita(chatId);
  const wa = f.phone?.replace(/\D/g, "");
  const msg = `Hola ${(f.name ?? "").split(" ")[0]}, le confirmamos su cita en The Heure Society el ${whenText(r.startsAt)}${f.kind === "video" ? " por videollamada" : " en 169 East Flagler St, Suite 1122, Miami"}. ¡Le esperamos!`;
  return sendMessage(chatId, `✅ <b>Cita agendada</b>\n${h(whenText(r.startsAt))} · ${h(f.name ?? "")}\nYa sale en el CRM y el horario queda ocupado en la web y los bots.`, {
    reply_markup: keyboard([...(wa ? [[{ text: "📲 Confirmar al cliente por WhatsApp", url: `https://wa.me/${wa}?text=${encodeURIComponent(msg)}` }]] : []), [{ text: "📅 Ver citas de hoy", callback_data: "mcit:today" }]]),
  });
}

// Cambio de hora de una cita existente
async function reschedule(chatId: number, f: CitaFlow, force = false) {
  const start = miamiToUtc(f.date!, f.time!);
  const clash = await slotClash(start, f.rescheduleId);
  if (clash && !force) return sendMessage(chatId, `⚠️ ${h(clashText(clash))}`, { reply_markup: keyboard([[{ text: "Cambiar igual", callback_data: "dapt:force|1" }, { text: "Elegir otra hora", callback_data: "dapt:retime|1" }]]) });
  const { data, error } = await adminDb().from("appointments").update({ starts_at: start.toISOString() }).eq("id", f.rescheduleId!).select("customer_id, name, phone").single();
  await clearCita(chatId);
  if (error) return sendMessage(chatId, `⚠️ ${error.code === "23505" ? "Ya hay otra cita exactamente a esa hora." : h(error.message)}`);
  if (data?.customer_id) await addEvent(data.customer_id, "appointment", `Cita cambiada al ${whenText(start)}`, { appointment: f.rescheduleId }, f.user);
  const wa = (data?.phone as string | null)?.replace(/\D/g, "");
  const msg = `Hola ${String(data?.name ?? "").split(" ")[0]}, le confirmamos el cambio de su cita en The Heure Society: ${whenText(start)}. ¡Le esperamos!`;
  return sendMessage(chatId, `🔁 <b>Cita cambiada</b> · ${h(whenText(start))} · ${h(String(data?.name ?? ""))}`, {
    reply_markup: wa ? keyboard([[{ text: "📲 Avisar al cliente por WhatsApp", url: `https://wa.me/${wa}?text=${encodeURIComponent(msg)}` }]]) : undefined,
  });
}

// ───────────────────────────── Seguimiento ─────────────────────────────
async function askCallTime(chatId: number, f: CitaFlow) {
  f.step = "fctime";
  await saveFlow(chatId, f);
  const times = ["10:00", "12:00", "15:00", "17:00", "19:00"];
  return sendMessage(chatId, `🕒 <b>${h(dayLabel(f.date!))}</b> · ¿a qué hora te lo recuerdo? O escribe la hora (ej. <code>4:30 pm</code>).`, {
    reply_markup: keyboard([...rows3(times.map((t) => ({ text: hour12(miamiToUtc(f.date!, t)), callback_data: `dapt:ctime|${t}` }))), [{ text: "Sin hora (todo el día)", callback_data: "dapt:ctime|-" }]]),
  });
}

async function askCallNote(chatId: number, f: CitaFlow) {
  f.step = "fcall";
  await saveFlow(chatId, f);
  const rows: InlineButton[][] = f.callNote ? [[{ text: `Usar: «${f.callNote}»`.slice(0, 60), callback_data: "dapt:callnote|default" }]] : [];
  rows.push([{ text: "Sin nota", callback_data: "dapt:callnote|-" }]);
  return sendMessage(chatId, "📝 ¿Para qué es el recordatorio? (ej. «ver si se decidió por el Daytona»)", { reply_markup: keyboard(rows) });
}

async function saveCall(chatId: number, f: CitaFlow, note: string | null) {
  const r = await scheduleCall(f.callFor!, f.date!, note, f.user, f.time ?? null);
  await clearCita(chatId);
  const when = `${dayLabel(f.date!)}${f.time ? ` a las ${f.time}` : ""}`;
  const rows: InlineButton[][] = [];
  if (r?.link) rows.push([{ text: "📅 Añadir a Google Calendar", url: r.link }]);
  rows.push([{ text: "Ver la cita", callback_data: `dapx:show|${f.callFor}` }]);
  return sendMessage(
    chatId,
    `🔔 <b>Recordatorio de seguimiento</b> · ${h(r?.name ?? "")}\n${h(when)}${note ? `\n📝 ${h(note)}` : ""}\n\nSale en tu calendario de citas (si lo tienes sincronizado) con aviso${f.time ? " a esa hora" : " a las 9:00"}, en el resumen de las 8:00 y en «👥 Clientes de hoy».`,
    { reply_markup: keyboard(rows) }
  );
}

// Mes primero, como en EE. UU.: «10/25», «10/25/2026» o «2026-10-25» → AAAA-MM-DD
// (si ese día ya pasó este año, el año que viene)
export function parseDate(text: string) {
  const iso = text.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const m = text.match(/(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?/);
  if (!m) return null;
  const [month, day] = [Number(m[1]), Number(m[2])];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const today = todayInMiami();
  let y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : Number(today.slice(0, 4));
  const key = (yy: number) => `${yy}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (!m[3] && key(y) < today) y += 1;
  return key(y);
}
// «15:30», «3:30 pm», «15», «3pm» → HH:MM. Sin am/pm, de la 1 a las 7 se entiende por la tarde
// (horario de la tienda): «3:30» = 15:30.
export function parseTime(text: string) {
  const m = text.toLowerCase().match(/(\d{1,2})(?:[:.h](\d{2}))?\s*(am|pm|a\.\s?m\.?|p\.\s?m\.?)?/);
  if (!m) return null;
  let hh = Number(m[1]);
  const mm = Number(m[2] ?? 0);
  if (m[3]?.startsWith("p") && hh < 12) hh += 12;
  if (m[3]?.startsWith("a") && hh === 12) hh = 0;
  if (!m[3] && hh >= 1 && hh <= 7) hh += 12;
  return hh <= 23 && mm <= 59 ? `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}` : null;
}

// Respuestas de texto del asistente. Devuelve false si no hay ninguna cita a medias.
export async function onCitaText(chatId: number, text: string) {
  const f = await getFlow(chatId);
  if (!f) return false;
  if (f.step === "client") {
    const phoneRaw = text.match(/\+?\d[\d\s().-]{6,}\d/)?.[0] ?? null;
    const name = text.replace(phoneRaw ?? "", "").replace(/[,;·|]+/g, " ").replace(/\s+/g, " ").trim() || null;
    const phone = normalizePhone(phoneRaw);
    const filters = [phone && `phone.ilike.%${phone.replace(/\D/g, "").slice(-7)}%`, name && name.length > 2 && `name.ilike.%${name.replace(/[,()"%]/g, "")}%`].filter(Boolean).join(",");
    const { data } = filters ? await adminDb().from("customers").select("id, name, phone").or(filters).limit(5) : { data: [] };
    f.name = name;
    f.phone = phone;
    await saveFlow(chatId, f);
    if (data?.length) {
      const rows: InlineButton[][] = data.map((c) => [{ text: `👤 ${c.name ?? "Sin nombre"}${c.phone ? ` · ${c.phone}` : ""}`.slice(0, 60), callback_data: `dapt:cli|${c.id}` }]);
      if (name || phone) rows.push([{ text: `➕ Nuevo: ${name ?? phone}`.slice(0, 60), callback_data: "dapt:cli|new" }]);
      await sendMessage(chatId, "Encontré estos clientes en el CRM. ¿Es alguno?", { reply_markup: keyboard(rows) });
      return true;
    }
    if (!name) return sendMessage(chatId, "Escribe al menos el nombre del cliente.").then(() => true);
    await askDay(chatId, f);
    return true;
  }
  if (f.step === "day") {
    const d = parseDate(text);
    if (!d) return sendMessage(chatId, "No entendí la fecha. Escríbela con el mes primero: <code>10/25</code>.").then(() => true);
    f.date = d;
    if (f.callFor) await askCallTime(chatId, f);
    else await askTime(chatId, f);
    return true;
  }
  if (f.step === "fctime") {
    const t = parseTime(text);
    if (!t) return sendMessage(chatId, "No entendí la hora. Escríbela así: <code>15:30</code> o <code>3:30 pm</code>.").then(() => true);
    f.time = t;
    await askCallNote(chatId, f);
    return true;
  }
  if (f.step === "fnote") {
    await addFollowupNote(f.noteFor!, text.slice(0, 1000), f.user);
    await clearCita(chatId);
    await sendMessage(chatId, "📝 Nota guardada en la cita y en la ficha del cliente.", { reply_markup: keyboard([[{ text: "Ver la cita", callback_data: `dapx:show|${f.noteFor}` }]]) });
    return true;
  }
  if (f.step === "fcall") {
    await saveCall(chatId, f, text.slice(0, 300));
    return true;
  }
  if (f.step === "time") {
    const t = parseTime(text);
    if (!t) return sendMessage(chatId, "No entendí la hora. Escríbela así: <code>15:30</code> o <code>3:30 pm</code>.").then(() => true);
    f.time = t;
    if (f.rescheduleId) await reschedule(chatId, f);
    else await askKind(chatId, f);
    return true;
  }
  if (f.step === "note") {
    f.note = text.slice(0, 300);
    await summary(chatId, f);
    return true;
  }
  await sendMessage(chatId, "Usa los botones de arriba, o /cancelar para salir.");
  return true;
}

// ───────────────────────────── Ver citas ─────────────────────────────
// Citas de los últimos 14 días sin resultado: para hacer el seguimiento
export async function listPastCitas(chatId: number) {
  const today = todayInMiami();
  const { data } = await adminDb()
    .from("appointments")
    .select("id, starts_at, name, outcome")
    .neq("status", "cancelled")
    .gte("starts_at", miamiToUtc(addDays(today, -14), "00:00").toISOString())
    .lt("starts_at", new Date().toISOString())
    .order("starts_at", { ascending: false })
    .limit(20);
  const list = data ?? [];
  if (!list.length) return sendMessage(chatId, "No hay citas en los últimos 14 días.");
  const fmt = (iso: string) => new Intl.DateTimeFormat("es-ES", { timeZone: TIME_ZONE, weekday: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  return sendMessage(chatId, `🕘 <b>Citas pasadas</b> (14 días)
Toca una para anotar cómo fue, añadir notas, programar una llamada u otra cita.
${list.filter((a) => !a.outcome).length ? "❔ = sin resultado todavía" : ""}`, {
    reply_markup: keyboard(list.map((a) => [{ text: `${a.outcome ? "🏁" : "❔"} ${fmt(a.starts_at)} · ${a.name ?? ""}`.slice(0, 60), callback_data: `dapx:show|${a.id}` }])),
  });
}

export async function listCitas(chatId: number, range: "today" | "week") {
  const today = todayInMiami();
  const { data } = await adminDb()
    .from("appointments")
    .select("id, kind, starts_at, name, phone, status, note")
    .in("status", ["requested", "confirmed"])
    .gte("starts_at", miamiToUtc(today, "00:00").toISOString())
    .lt("starts_at", miamiToUtc(addDays(today, range === "today" ? 1 : 7), "00:00").toISOString())
    .order("starts_at");
  const list = data ?? [];
  const add = [{ text: "➕ Agendar cita", callback_data: "mcit:new" }];
  if (!list.length) return sendMessage(chatId, range === "today" ? "📅 Hoy no hay citas." : "📆 No hay citas en los próximos 7 días.", { reply_markup: keyboard([add]) });
  const fmt = (iso: string) =>
    new Intl.DateTimeFormat("es-ES", { timeZone: TIME_ZONE, ...(range === "week" && { weekday: "short", day: "numeric" }), hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  return sendMessage(
    chatId,
    [`${range === "today" ? "📅 <b>Citas de hoy</b>" : "📆 <b>Próximos 7 días</b>"} (${list.length})`, "", ...list.map((a) => `${a.status === "requested" ? "🕓" : "✅"} <b>${fmt(a.starts_at)}</b> · ${h(a.name ?? "")} · ${a.kind === "video" ? "🎥" : "🏛"}${a.note ? `\n   <i>${h(String(a.note).slice(0, 80))}</i>` : ""}`), "", "🕓 = pendiente de confirmar · toca una para gestionarla"].join("\n"),
    { reply_markup: keyboard([...list.map((a) => [{ text: `${fmt(a.starts_at)} · ${a.name ?? ""}`.slice(0, 60), callback_data: `dapx:show|${a.id}` }]), add]) }
  );
}

async function showCita(chatId: number, id: string) {
  const { data: a } = await adminDb().from("appointments").select("*").eq("id", id).maybeSingle();
  if (!a) return sendMessage(chatId, "Esa cita ya no existe.");
  const follow = (await followupsFor([id])).get(id) ?? [];
  const wa = (a.phone as string | null)?.replace(/\D/g, "");
  const rows: InlineButton[][] = [];
  const past = new Date(a.starts_at).getTime() < Date.now();
  if (a.status === "requested" && !past) rows.push([{ text: "✅ Confirmar", callback_data: `dapx:ok|${id}` }]);
  rows.push([{ text: "🔔 Follow-up", callback_data: `dapx:res|${id}` }]);
  rows.push([{ text: "📝 Añadir nota", callback_data: `dapx:note|${id}` }, { text: "⏰ Recordatorio", callback_data: `dapx:call|${id}` }]);
  rows.push([{ text: "📅 Otra cita para este cliente", callback_data: `dapx:next|${id}` }]);
  if (!past) rows.push([{ text: "🔁 Cambiar día u hora", callback_data: `dapx:move|${id}` }, { text: "❌ Cancelar cita", callback_data: `dapx:cancel|${id}` }]);
  if (wa) rows.push([{ text: "📲 Escribir por WhatsApp", url: `https://wa.me/${wa}` }]);
  if (a.customer_id) rows.push([{ text: "Ficha en el CRM", url: `${process.env.NEXT_PUBLIC_SITE_URL ?? "https://theheuresociety.vercel.app"}/admin/leads/${a.customer_id}` }]);
  return sendMessage(
    chatId,
    [
      `📅 <b>${h(whenText(new Date(a.starts_at)))}</b>`,
      `👤 ${h(a.name ?? "")}${a.phone ? ` · ${h(a.phone)}` : ""}`,
      a.kind === "video" ? "🎥 Videollamada" : "🏛 En la oficina",
      a.status === "cancelled" ? "❌ Cancelada" : a.status === "requested" ? "🕓 Pendiente de confirmar" : "✅ Confirmada",
      a.outcome ? `🔔 ${h(OUTCOME_LABEL[a.outcome] ?? a.outcome)}` : "",
      a.note ? `📝 ${h(a.note)}` : "",
      ...(follow.length ? ["", "<b>Seguimiento</b>", ...follow.map((x) => `• ${x.kind === "call" ? `⏰ Seguimiento el ${x.due_at}${x.due_time ? ` ${x.due_time}` : ""}${x.body ? `: ${h(x.body)}` : ""}${x.done_at ? " ✓" : ""}` : x.kind === "appointment" ? `📅 Nueva cita: ${h(x.body ?? "")}` : x.kind === "outcome" ? `🔔 ${h(x.body ?? "")}` : `📝 ${h(x.body ?? "")}`}`)] : []),
    ].filter((l) => l !== "").join("\n"),
    { reply_markup: keyboard(rows) }
  );
}

// ───────────────────────────── Botones ─────────────────────────────
export const CITA_ACTIONS = new Set(["dapt", "dapx"]);

export async function onCitaCallback(chatId: number, cbId: string, messageId: number, action: string, arg: string, user: string) {
  const answer = (text?: string) => tg("answerCallbackQuery", { callback_query_id: cbId, ...(text && { text }) }).catch(() => {});
  const clearButtons = () => tg("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: keyboard([]) }).catch(() => {});
  const [what, value] = arg.split("|");

  // Gestionar una cita ya agendada
  if (action === "dapx") {
    await answer();
    if (what === "show") return showCita(chatId, value);
    const db = adminDb();
    if (what === "ok" || what === "cancel") {
      await clearButtons();
      const status = what === "ok" ? "confirmed" : "cancelled";
      const { data } = await db.from("appointments").update({ status }).eq("id", value).select("customer_id, name, starts_at, phone").single();
      if (data?.customer_id) await addEvent(data.customer_id, "appointment", `Cita ${status === "confirmed" ? "confirmada" : "cancelada"}`, { appointment: value }, user);
      const wa = (data?.phone as string | null)?.replace(/\D/g, "");
      const when = data ? whenText(new Date(data.starts_at)) : "";
      const msg = status === "confirmed" ? `Hola ${String(data?.name ?? "").split(" ")[0]}, le confirmamos su cita en The Heure Society el ${when}. ¡Le esperamos!` : `Hola ${String(data?.name ?? "").split(" ")[0]}, su cita en The Heure Society del ${when} ha quedado cancelada. Escríbanos cuando quiera para buscar otra fecha.`;
      return sendMessage(chatId, `${status === "confirmed" ? "✅ Cita confirmada" : "❌ Cita cancelada: el horario queda libre"} · ${h(String(data?.name ?? ""))} · ${h(when)}`, {
        reply_markup: wa ? keyboard([[{ text: "📲 Avisar al cliente por WhatsApp", url: `https://wa.me/${wa}?text=${encodeURIComponent(msg)}` }]]) : undefined,
      });
    }
    if (what === "move") {
      await clearButtons();
      return askDay(chatId, { step: "day", user, rescheduleId: value });
    }
    if (what === "res") {
      return sendMessage(chatId, "🔔 <b>Follow-up</b> · ¿en qué punto está?", { reply_markup: keyboard(Object.entries(OUTCOME_LABEL).map(([k, l]) => [{ text: l, callback_data: `dapx:out|${value}.${k}` }])) });
    }
    if (what === "out") {
      await clearButtons();
      const [apptId, outcome] = value.split(".");
      await setOutcome(apptId, outcome, user);
      // Artículo enviado: directamente a programar el recordatorio de seguimiento
      if (outcome === "sent_waiting") {
        await sendMessage(chatId, "📦 Anotado: <b>artículo enviado, espera respuesta del cliente</b>.");
        return askDay(chatId, { step: "day", user, callFor: apptId, callNote: "Artículo enviado: ver si respondió" });
      }
      const tips: Record<string, string> = { thinking: "¿Le pones un recordatorio para dentro de unos días?", no_show: "¿Le escribes para buscar otra fecha?", bought: "¡Enhorabuena! Recuerda emitir la factura." };
      return sendMessage(chatId, `🔔 Follow-up guardado: <b>${h(OUTCOME_LABEL[outcome] ?? outcome)}</b>${tips[outcome] ? `\n${tips[outcome]}` : ""}`, {
        reply_markup: keyboard([[{ text: "⏰ Recordatorio", callback_data: `dapx:call|${apptId}` }, { text: "📅 Otra cita", callback_data: `dapx:next|${apptId}` }]]),
      });
    }
    if (what === "note") {
      await saveFlow(chatId, { step: "fnote", user, noteFor: value });
      return sendMessage(chatId, "📝 Escribe la nota (qué le gustó, presupuesto, próximos pasos…).");
    }
    if (what === "call") return askDay(chatId, { step: "day", user, callFor: value });
    if (what === "next") {
      const { data: a } = await db.from("appointments").select("customer_id, name, phone").eq("id", value).single();
      return askDay(chatId, { step: "day", user, nextFor: value, customerId: a?.customer_id ?? null, name: a?.name ?? null, phone: a?.phone ?? null });
    }
    return;
  }

  // Asistente para agendar
  const f = await getFlow(chatId);
  if (!f) {
    await answer("Esta cita ya no está en curso");
    return clearButtons();
  }
  await answer();
  await clearButtons();
  switch (what) {
    case "cli":
      if (value !== "new") {
        const { data: c } = await adminDb().from("customers").select("id, name, phone").eq("id", value).single();
        f.customerId = c?.id ?? null;
        f.name = c?.name ?? f.name;
        f.phone = c?.phone ?? f.phone;
      }
      return askDay(chatId, f);
    case "day":
      f.date = value;
      return f.callFor ? askCallTime(chatId, f) : askTime(chatId, f);
    case "ctime":
      f.time = value === "-" ? undefined : value;
      return askCallNote(chatId, f);
    case "time":
      f.time = value;
      return f.rescheduleId ? reschedule(chatId, f) : askKind(chatId, f);
    case "retime":
      return askDay(chatId, f);
    case "kind":
      f.kind = value === "video" ? "video" : "office";
      return askNote(chatId, f);
    case "note":
      f.note = null;
      return summary(chatId, f);
    case "callnote":
      return saveCall(chatId, f, value === "default" ? f.callNote ?? null : null);
    case "ok":
      return create(chatId, f, value === "1");
    case "force":
      return f.rescheduleId ? reschedule(chatId, f, true) : create(chatId, f, value === "1", true);
    case "no":
      await clearCita(chatId);
      return sendMessage(chatId, "Cita descartada. No se agendó nada.");
  }
}

// Resumen de las 8:00: por cada cita de ayer sin follow-up, los botones para anotarlo
export async function askYesterdayOutcomes() {
  const today = todayInMiami();
  const { data } = await adminDb()
    .from("appointments")
    .select("id, starts_at, name, kind")
    .neq("status", "cancelled")
    .is("outcome", null)
    .gte("starts_at", miamiToUtc(addDays(today, -1), "00:00").toISOString())
    .lt("starts_at", miamiToUtc(today, "00:00").toISOString())
    .order("starts_at");
  const { notifyAdmins } = await import("./telegram");
  for (const a of data ?? []) {
    await notifyAdmins(`🔔 <b>Follow-up de la cita de ayer</b>\n${h(a.name ?? "")} · ${timeLabel(new Date(a.starts_at))} · ${a.kind === "video" ? "🎥" : "🏛"}`, {
      reply_markup: keyboard([...Object.entries(OUTCOME_LABEL).map(([k, l]) => [{ text: l, callback_data: `dapx:out|${a.id}.${k}` }]), [{ text: "Ver la cita", callback_data: `dapx:show|${a.id}` }]]),
    });
  }
}

// Agendar con el cliente ya elegido (p. ej. al cerrar un recordatorio)
export async function startCitaFor(chatId: number, user: string, c: { customerId: string | null; name: string | null; phone: string | null }) {
  await sendMessage(chatId, `📅 <b>Nueva cita</b> · ${h(c.name ?? "")}`);
  return askDay(chatId, { step: "day", user, customerId: c.customerId, name: c.name, phone: c.phone });
}
