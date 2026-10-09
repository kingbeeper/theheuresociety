import { adminDb } from "@/lib/supabase";
import { validCalendarKey } from "@/lib/calendar";
import { booking, contact } from "@/lib/site";
import { SITE_URL } from "@/lib/seo";

// Feed iCalendar con las citas (web, WhatsApp, Instagram y manuales). El teléfono lo vuelve a leer solo.
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, (m) => `\\${m}`);
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

export async function GET(request: Request) {
  if (!validCalendarKey(new URL(request.url).searchParams.get("key"))) return new Response("No autorizado", { status: 401 });
  const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
  const { data } = await adminDb().from("appointments").select("*").gte("starts_at", since).order("starts_at");
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

  const body = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//The Heure Society//CRM//ES", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "X-WR-CALNAME:Citas · The Heure Society", "X-WR-TIMEZONE:America/New_York", "REFRESH-INTERVAL;VALUE=DURATION:PT15M", "X-PUBLISHED-TTL:PT15M",
    ...events, "END:VCALENDAR"].join("\r\n");
  return new Response(body, { headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "no-store" } });
}
