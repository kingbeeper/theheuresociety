import "server-only";
import { adminDb } from "./supabase";
import { addEvent, STAGE_LABEL, upsertLead } from "./crm";
import { miamiToUtc, slotClash, TIME_ZONE } from "./booking";
import { escapeHtml, notifyAdmins } from "./telegram";

// Citas añadidas a mano (CRM o Telegram). Misma tabla que las de la web y los bots: el horario queda
// ocupado para todos los canales, y la cita sale en el panel, la ficha del cliente, el resumen y el calendario.

export const whenText = (d: Date) =>
  new Intl.DateTimeFormat("es-US", { timeZone: TIME_ZONE, weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit", hour12: true }).format(d);
export const clashText = (c: { name: string; starts_at: string }) =>
  `Ese horario choca con la cita de ${c.name} (${new Intl.DateTimeFormat("es-ES", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit" }).format(new Date(c.starts_at))}).`;

export type NewAppointment = {
  customerId?: string | null;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  source?: string | null;
  date: string; // AAAA-MM-DD, hora de Miami
  time: string; // HH:MM
  kind: "office" | "video";
  note?: string | null;
  pieces?: string[];
  confirmed: boolean;
  force?: boolean; // agendar aunque choque con otra cita
  via?: string; // «el CRM» o «Telegram», para el aviso
};

export async function addAppointment(a: NewAppointment, user: string): Promise<{ ok: true; id: string; startsAt: Date } | { error: string; clash?: boolean }> {
  const db = adminDb();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a.date) || !/^\d{2}:\d{2}$/.test(a.time)) return { error: "Falta la fecha o la hora." };
  const startsAt = miamiToUtc(a.date, a.time);
  const clash = await slotClash(startsAt);
  if (clash && !a.force) return { error: clashText(clash), clash: true };

  // Cliente: uno del CRM o uno nuevo (se crea como lead con la etapa «Cita»)
  let customerId = a.customerId ?? null;
  let c: { name: string | null; phone: string | null; email: string | null; stage: string } | null = null;
  if (customerId) {
    const { data } = await db.from("customers").select("name, phone, email, stage").eq("id", customerId).single();
    c = data;
    if (c && ["new", "contacted", "qualified"].includes(c.stage)) {
      await db.from("customers").update({ stage: "appointment", last_activity_at: new Date().toISOString() }).eq("id", customerId);
      await addEvent(customerId, "stage", `Etapa: ${STAGE_LABEL.appointment}`, { from: c.stage, to: "appointment" }, user);
    }
  } else {
    if (!a.name) return { error: "Falta el nombre del cliente." };
    const lead = await upsertLead({ name: a.name, phone: a.phone ?? null, email: a.email ?? null, source: a.source ?? "other", intent: "buy", stage: "appointment", notify: false });
    customerId = lead.id;
    c = lead;
  }
  const name = c?.name ?? a.name ?? "Cliente";
  const status = a.confirmed ? "confirmed" : "requested";

  const { data: appt, error } = await db
    .from("appointments")
    .insert({ kind: a.kind, starts_at: startsAt.toISOString(), name, phone: c?.phone ?? null, email: c?.email ?? null, pieces: a.pieces ?? [], note: a.note ?? null, source: "manual", status, customer_id: customerId })
    .select("id")
    .single();
  if (error?.code === "23505") return { error: "Ya hay otra cita exactamente a esa hora." };
  if (error) return { error: error.message };

  const label = a.kind === "office" ? "oficina" : "videollamada";
  await addEvent(customerId!, "appointment", `Cita ${status === "confirmed" ? "confirmada" : "pendiente"} (${label}) el ${whenText(startsAt)}${a.note ? ` · ${a.note}` : ""}`, { appointment: appt.id, pieces: a.pieces ?? [] }, user);
  await notifyAdmins(
    [`📅 <b>Cita añadida en ${a.via ?? "el CRM"}</b> por ${escapeHtml(user)}`, `${a.kind === "office" ? "🏛 En la oficina" : "🎥 Videollamada"} · <b>${escapeHtml(whenText(startsAt))}</b>`, escapeHtml(name), a.note ? `Nota: ${escapeHtml(a.note)}` : ""]
      .filter(Boolean)
      .join("\n")
  ).catch(() => {});
  return { ok: true, id: appt.id as string, startsAt };
}

// ───────────────────────────── Seguimiento de cada cita ─────────────────────────────
export const OUTCOME_LABEL: Record<string, string> = {
  sent_waiting: "Artículo enviado, espera respuesta del cliente",
  bought: "Vino y compró",
  thinking: "Vino, lo está pensando",
  no_show: "No vino",
  not_interested: "Vino, no le interesa",
  other: "Otro",
};

export type FollowUp = { id: string; kind: "note" | "call" | "appointment" | "outcome"; body: string | null; due_at: string | null; due_time?: string | null; done_at: string | null; new_appointment_id: string | null; created_by: string | null; created_at: string };

async function apptCustomer(appointmentId: string) {
  const { data } = await adminDb().from("appointments").select("id, customer_id, name, starts_at, kind, phone").eq("id", appointmentId).single();
  return data as { id: string; customer_id: string | null; name: string | null; starts_at: string; kind: string; phone: string | null } | null;
}

export async function followupsFor(appointmentIds: string[]) {
  if (!appointmentIds.length) return new Map<string, FollowUp[]>();
  const { data } = await adminDb().from("appointment_followups").select("*").in("appointment_id", appointmentIds).order("created_at");
  const out = new Map<string, FollowUp[]>();
  for (const f of (data ?? []) as (FollowUp & { appointment_id: string })[]) out.set(f.appointment_id, [...(out.get(f.appointment_id) ?? []), f]);
  return out;
}

export async function addFollowupNote(appointmentId: string, body: string, user: string) {
  const a = await apptCustomer(appointmentId);
  if (!a) return;
  await adminDb().from("appointment_followups").insert({ appointment_id: a.id, customer_id: a.customer_id, kind: "note", body, created_by: user });
  if (a.customer_id) await addEvent(a.customer_id, "note", `Seguimiento de la cita: ${body}`, { appointment: a.id }, user);
}

// Recordatorio de seguimiento (llamar, ver si responde…): queda como «seguimiento» del cliente (resumen
// de las 8:00 y «Clientes de hoy») y en el calendario de citas. `time` (HH:MM) es opcional.
export async function scheduleCall(appointmentId: string, date: string, note: string | null, user: string, time: string | null = null) {
  const a = await apptCustomer(appointmentId);
  if (!a || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const db = adminDb();
  const due_time = time && /^\d{2}:\d{2}$/.test(time) ? time : null;
  await db.from("appointment_followups").insert({ appointment_id: a.id, customer_id: a.customer_id, kind: "call", body: note, due_at: date, due_time, created_by: user });
  if (a.customer_id) {
    const followNote = `Seguimiento${due_time ? ` a las ${due_time}` : ""} (cita del ${whenText(new Date(a.starts_at))})${note ? `: ${note}` : ""}`.slice(0, 300);
    await db.from("customers").update({ follow_up_at: date, follow_up_note: followNote, last_activity_at: new Date().toISOString() }).eq("id", a.customer_id);
    await addEvent(a.customer_id, "follow_up", `Seguimiento programado para el ${date}${due_time ? ` a las ${due_time}` : ""}${note ? `: ${note}` : ""}`, { appointment: a.id }, user);
  }
  return { name: a.name, phone: a.phone, customerId: a.customer_id, link: googleCalendarLink(`📞 Seguimiento: ${a.name ?? "cliente"}`, date, due_time, [note, a.phone && `Tel: ${a.phone}`].filter(Boolean).join("\n")) };
}

// Enlace para añadir el recordatorio a Google Calendar al momento (hora de Miami; sin hora = todo el día)
export function googleCalendarLink(title: string, date: string, time: string | null, details = "") {
  const d = date.replace(/-/g, "");
  let dates: string;
  if (time) {
    const [hh, mm] = time.split(":").map(Number);
    const end = hh * 60 + mm + 15;
    dates = `${d}T${time.replace(":", "")}00/${d}T${String(Math.floor(end / 60) % 24).padStart(2, "0")}${String(end % 60).padStart(2, "0")}00`;
  } else {
    const next = new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10) + 1)).toISOString().slice(0, 10).replace(/-/g, "");
    dates = `${d}/${next}`;
  }
  const q = new URLSearchParams({ action: "TEMPLATE", text: title, dates, ctz: TIME_ZONE, details });
  return `https://calendar.google.com/calendar/render?${q}`;
}

export async function completeCall(followupId: string, result: string | null, user: string) {
  const db = adminDb();
  const { data: f } = await db.from("appointment_followups").update({ done_at: new Date().toISOString(), ...(result && { body: result }) }).eq("id", followupId).select("appointment_id, customer_id, due_at, body").single();
  if (f?.customer_id) {
    await db.from("customers").update({ follow_up_at: null, follow_up_note: null, last_activity_at: new Date().toISOString() }).eq("id", f.customer_id).eq("follow_up_at", f.due_at);
    await addEvent(f.customer_id, "follow_up", `Llamada hecha${result ? `: ${result}` : ""}`, { appointment: f.appointment_id }, user);
  }
}

export async function setOutcome(appointmentId: string, outcome: string, user: string) {
  if (!OUTCOME_LABEL[outcome]) return;
  const a = await apptCustomer(appointmentId);
  if (!a) return;
  const db = adminDb();
  await db.from("appointments").update({ outcome }).eq("id", a.id);
  await db.from("appointment_followups").insert({ appointment_id: a.id, customer_id: a.customer_id, kind: "outcome", body: OUTCOME_LABEL[outcome], created_by: user });
  if (a.customer_id) await addEvent(a.customer_id, "appointment", `Resultado de la cita: ${OUTCOME_LABEL[outcome]}`, { appointment: a.id, outcome }, user);
}

// Otra cita para el mismo cliente, enlazada a esta
export async function followupAppointment(appointmentId: string, n: Omit<NewAppointment, "customerId" | "name" | "phone">, user: string) {
  const a = await apptCustomer(appointmentId);
  if (!a) return { error: "La cita ya no existe." };
  const r = await addAppointment({ ...n, customerId: a.customer_id, name: a.customer_id ? null : a.name, phone: a.customer_id ? null : a.phone }, user);
  if ("ok" in r) await adminDb().from("appointment_followups").insert({ appointment_id: a.id, customer_id: a.customer_id, kind: "appointment", body: whenText(r.startsAt), new_appointment_id: r.id, created_by: user });
  return r;
}
