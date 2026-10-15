import { adminDb } from "@/lib/supabase";
import { validCalendarKey } from "@/lib/calendar";
import { booking, contact } from "@/lib/site";
import { SITE_URL } from "@/lib/seo";
import { miamiToUtc } from "@/lib/booking";

// Feed iCalendar con las citas (web, WhatsApp, Instagram y manuales). El teléfono lo vuelve a leer solo.
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, (m) => `\\${m}`);
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

export async function GET(request: Request) {
  if (!validCalendarKey(new URL(request.url).searchParams.get("key"))) return new Response("No autorizado", { status: 401 });
  const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
  const { data } = await adminDb().from("appointments").select("*").gte("starts_at", since).order("starts_at");
  // Recordatorios de seguimiento pendientes (con hora o de todo el día, con aviso)
  const { data: calls } = await adminDb()
    .from("appointment_followups")
    .select("id, body, due_at, due_time, customer_id, appointment:appointments!appointment_followups_appointment_id_fkey(name, phone)")
    .eq("kind", "call")
    .is("done_at", null)
    .gte("due_at", since.slice(0, 10));
  const address = `${contact.address.street}, ${contact.address.city}, ${contact.address.region} ${contact.address.postalCode}`;
  const now = stamp(new Date());

  const events = (data ?? []).flatMap((a) => {
    const start = new Date(a.starts_at as string);
    const end = new Date(start.getTime() + booking.durationMinutes * 60_000);
    const office = a.kind === "office";
    const details = [
      a.phone && `Tel: ${a.phone}`,
      a.email && `Correo: ${a.email}`,
      (a.pieces as string[])?.length && `Quiere ver: ${(a.pieces as string[]).join(", ")}`,
      a.note && `Nota: ${a.note}`,
      a.status === "requested" && "Pendiente de confirmar",
      a.customer_id && `${SITE_URL}/admin/leads/${a.customer_id}`,
    ].filter(Boolean).join("\n");
    return [
      "BEGIN:VEVENT",
      `UID:${a.id}@theheuresociety`,
      `DTSTAMP:${now}`,
      `DTSTART:${stamp(start)}`,
      `DTEND:${stamp(end)}`,
      `SUMMARY:${esc(`${office ? "🏛" : "🎥"} ${a.name}${a.status === "requested" ? " (por confirmar)" : ""}`)}`,
      `DESCRIPTION:${esc(details)}`,
      office ? `LOCATION:${esc(address)}` : "",
      `STATUS:${a.status === "cancelled" ? "CANCELLED" : a.status === "confirmed" ? "CONFIRMED" : "TENTATIVE"}`,
      "BEGIN:VALARM", "TRIGGER:-PT1H", "ACTION:DISPLAY", "DESCRIPTION:Cita en 1 hora", "END:VALARM",
      "END:VEVENT",
    ].filter(Boolean);
  });

  type Call = { id: string; body: string | null; due_at: string; due_time: string | null; customer_id: string | null; appointment: { name: string | null; phone: string | null } | null };
  const reminders = ((calls ?? []) as unknown as Call[]).flatMap((c) => {
    const d = c.due_at.replace(/-/g, "");
    const timed = Boolean(c.due_time);
    const start = timed ? stamp(miamiToUtc(c.due_at, c.due_time!)) : null;
    const end = timed ? stamp(new Date(miamiToUtc(c.due_at, c.due_time!).getTime() + 15 * 60_000)) : null;
    const next = new Date(Date.UTC(+c.due_at.slice(0, 4), +c.due_at.slice(5, 7) - 1, +c.due_at.slice(8, 10) + 1)).toISOString().slice(0, 10).replace(/-/g, "");
    const details = [c.body, c.appointment?.phone && `Tel: ${c.appointment.phone}`, c.customer_id && `${SITE_URL}/admin/leads/${c.customer_id}`].filter(Boolean).join("\n");
    return [
      "BEGIN:VEVENT",
      `UID:fu-${c.id}@theheuresociety`,
      `DTSTAMP:${now}`,
      timed ? `DTSTART:${start}` : `DTSTART;VALUE=DATE:${d}`,
      timed ? `DTEND:${end}` : `DTEND;VALUE=DATE:${next}`,
      `SUMMARY:${esc(`📞 Seguimiento: ${c.appointment?.name ?? "cliente"}`)}`,
      `DESCRIPTION:${esc(details)}`,
      "BEGIN:VALARM", timed ? "TRIGGER:PT0M" : "TRIGGER:PT9H", "ACTION:DISPLAY", "DESCRIPTION:Seguimiento del cliente", "END:VALARM",
      "END:VEVENT",
    ];
  });

  const { data: rems } = await adminDb().from("reminders").select("id, body, due_at, all_day, customer_id, customer:customers(name, phone)").is("done_at", null).gte("due_at", since);
  type Rem = { id: string; body: string; due_at: string; all_day: boolean; customer_id: string | null; customer: { name: string | null; phone: string | null } | null };
  const clientReminders = ((rems ?? []) as unknown as Rem[]).flatMap((r) => {
    const start = new Date(r.due_at);
    const day = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/New_York" }).format(start);
    const d = day.replace(/-/g, "");
    const next = new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10) + 1)).toISOString().slice(0, 10).replace(/-/g, "");
    const details = [r.body, r.customer?.phone && `Tel: ${r.customer.phone}`, r.customer_id && `${SITE_URL}/admin/leads/${r.customer_id}`].filter(Boolean).join("\n");
    return [
      "BEGIN:VEVENT",
      `UID:rem-${r.id}@theheuresociety`,
      `DTSTAMP:${now}`,
      r.all_day ? `DTSTART;VALUE=DATE:${d}` : `DTSTART:${stamp(start)}`,
      r.all_day ? `DTEND;VALUE=DATE:${next}` : `DTEND:${stamp(new Date(start.getTime() + 15 * 60_000))}`,
      `SUMMARY:${esc(`⏰ ${r.customer?.name ?? "Cliente"}: ${r.body.slice(0, 60)}`)}`,
      `DESCRIPTION:${esc(details)}`,
      "BEGIN:VALARM", r.all_day ? "TRIGGER:PT9H" : "TRIGGER:PT0M", "ACTION:DISPLAY", "DESCRIPTION:Recordatorio de cliente", "END:VALARM",
      "END:VEVENT",
    ];
  });

  const body = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//The Heure Society//CRM//ES", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "X-WR-CALNAME:Citas · The Heure Society", "X-WR-TIMEZONE:America/New_York", "REFRESH-INTERVAL;VALUE=DURATION:PT15M", "X-PUBLISHED-TTL:PT15M",
    ...events, ...reminders, ...clientReminders, "END:VCALENDAR"].join("\r\n");
  return new Response(body, { headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "no-store" } });
}
