import "server-only";
import { adminDb } from "./supabase";
import { addEvent, STAGE_LABEL, upsertLead } from "./crm";
import { miamiToUtc, slotClash, TIME_ZONE } from "./booking";
import { escapeHtml, notifyAdmins } from "./telegram";

// Citas añadidas a mano (CRM o Telegram). Misma tabla que las de la web y los bots: el horario queda
// ocupado para todos los canales, y la cita sale en el panel, la ficha del cliente, el resumen y el calendario.

export const whenText = (d: Date) =>
  new Intl.DateTimeFormat("es-ES", { timeZone: TIME_ZONE, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(d);
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
