import Link from "next/link";
import { connection } from "next/server";
import { adminDb } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";
import { getWatches } from "@/lib/inventory";
import { Card, fmtDateTime, ghostButtonClass, PageTitle, requestTime } from "@/components/admin/ui";
import { AppointmentForm, RescheduleForm } from "@/components/admin/AppointmentForm";
import { TIME_ZONE, todayInMiami } from "@/lib/booking";
import { calendarKey } from "@/lib/calendar";
import { SITE_URL } from "@/lib/seo";
import { setAppointmentStatus } from "../../actions";

export const metadata = { title: "Citas" };

const SOURCE: Record<string, string> = { web: "web", whatsapp: "WhatsApp", instagram: "Instagram", facebook: "Messenger", manual: "añadida a mano" };
const STATUS = { requested: "Pendiente de confirmar", confirmed: "Confirmada", cancelled: "Cancelada" } as const;

export default async function CitasPage({ searchParams }: PageProps<"/admin/citas">) {
  await connection();
  // La plantilla y la página se generan en paralelo: cada página comprueba la sesión antes de leer datos
  await requireAdmin();
  const db = adminDb();
  const since = new Date(requestTime() - 30 * 86_400_000).toISOString();
  const sp = await searchParams;
  const preset = typeof sp.cliente === "string" ? sp.cliente : undefined;
  const [{ data }, watches, { data: customers }] = await Promise.all([
    db.from("appointments").select("*").gte("starts_at", since).order("starts_at"),
    getWatches(),
    db.from("customers").select("id, name, phone, email").order("last_activity_at", { ascending: false }).limit(500),
  ]);
  const customerOptions = (customers ?? []).map((c) => ({ id: c.id as string, label: [c.name ?? "Sin nombre", c.phone ?? c.email].filter(Boolean).join(" · ") }));
  const watchOptions = watches.filter((w) => w.status !== "sold").map((w) => ({ id: w.slug, label: `${w.brand} ${w.model} · ${w.reference}` }));
  const today = todayInMiami(new Date(requestTime()));
  const key = calendarKey();
  const feed = key ? `${SITE_URL}/api/calendar?key=${key}` : null;
  // Fecha y hora de Miami de una cita, para el formulario de cambio
  const local = (iso: string) => {
    const [d, t] = new Intl.DateTimeFormat("sv-SE", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso)).split(" ");
    return { d, t };
  };
  const nowIso = new Date(requestTime()).toISOString();
  const upcoming = (data ?? []).filter((a) => a.starts_at >= nowIso && a.status !== "cancelled");
  const past = (data ?? []).filter((a) => a.starts_at < nowIso || a.status === "cancelled").reverse();
  const name = (slug: string) => {
    const w = watches.find((x) => x.slug === slug);
    return w ? `${w.brand} ${w.model}` : slug;
  };

  // Mensaje de confirmación listo para enviar por WhatsApp
  const confirmText = (a: Record<string, unknown>) =>
    `Hola ${String(a.name).split(" ")[0]}, le confirmamos su ${a.kind === "office" ? "visita a nuestra oficina (169 East Flagler St, Suite 1122, Miami)" : "videollamada"} el ${fmtDateTime(a.starts_at as string)}. Muchas gracias. — The Heure Society`;

  const row = (a: Record<string, unknown>, actions: boolean) => {
    const phone = (a.phone as string | null)?.replace(/\D/g, "");
    return (
      <li key={a.id as string} className="grid gap-3 border-b border-line/60 py-4 md:grid-cols-[180px_1fr_auto] md:items-center">
        <div>
          <p className="font-display text-xl">{fmtDateTime(a.starts_at as string)}</p>
          <p className="text-xs text-stone">{a.kind === "office" ? "Oficina" : "Videollamada"} · {SOURCE[a.source as string] ?? a.source}</p>
        </div>
        <div className="text-sm">
          {a.customer_id ? (
            <Link href={`/admin/leads/${a.customer_id}`} className="hover:text-brass">{a.name as string}</Link>
          ) : (
            <span>{a.name as string}</span>
          )}
          <span className="text-stone"> · {(a.phone as string) ?? (a.email as string) ?? ""}</span>
          {(a.pieces as string[])?.length > 0 && <p className="text-xs text-stone">Quiere ver: {(a.pieces as string[]).map(name).join(", ")}</p>}
          {Boolean(a.note) && <p className="text-xs text-stone">Nota: {a.note as string}</p>}
          {actions && <RescheduleForm id={a.id as string} date={local(a.starts_at as string).d} time={local(a.starts_at as string).t} />}
          <p className={`mt-1 text-[0.62rem] tracking-[0.18em] uppercase ${a.status === "confirmed" ? "text-emerald-200" : a.status === "cancelled" ? "text-stone/60" : "text-amber-200"}`}>
            {STATUS[a.status as keyof typeof STATUS]}
          </p>
        </div>
        {actions && (
          <div className="flex flex-wrap gap-2">
            {a.status !== "confirmed" && (
              <form action={setAppointmentStatus.bind(null, a.id as string, "confirmed")}><button className={ghostButtonClass}>Confirmar</button></form>
            )}
            {phone && (
              <a href={`https://wa.me/${phone}?text=${encodeURIComponent(confirmText(a))}`} target="_blank" rel="noreferrer" className={ghostButtonClass}>
                Avisar por WhatsApp
              </a>
            )}
            <form action={setAppointmentStatus.bind(null, a.id as string, "cancelled")}><button className={ghostButtonClass}>Cancelar</button></form>
          </div>
        )}
      </li>
    );
  };

  return (
    <>
      <PageTitle eyebrow="CRM" title="Citas" />
      <details id="nueva" open={Boolean(preset)} className="mb-6 border border-line bg-forest/60">
        <summary className="cursor-pointer px-5 py-4 text-[0.66rem] tracking-[0.24em] uppercase text-brass">+ Nueva cita</summary>
        <div className="border-t border-line px-5 py-5">
          <AppointmentForm customers={customerOptions} watches={watchOptions} customerId={preset} today={today} />
        </div>
      </details>
      <section className="border border-line bg-forest/60 px-5">
        <h2 className="pt-5 text-[0.66rem] tracking-[0.24em] uppercase text-stone">Próximas</h2>
        {upcoming.length ? <ul>{upcoming.map((a) => row(a, true))}</ul> : <p className="py-6 text-sm text-stone">No hay citas próximas.</p>}
      </section>
      <section className="mt-6 border border-line bg-forest/40 px-5">
        <h2 className="pt-5 text-[0.66rem] tracking-[0.24em] uppercase text-stone">Últimos 30 días y canceladas</h2>
        {past.length ? <ul>{past.map((a) => row(a, false))}</ul> : <p className="py-6 text-sm text-stone">Nada todavía.</p>}
      </section>
      {feed && (
        <Card title="Ver las citas en el calendario del teléfono" className="mt-6">
          <p className="text-sm text-stone">
            Suscríbete una vez y todas las citas (web, WhatsApp, Instagram y las que añadas aquí) aparecen solas en tu calendario, con aviso una hora antes.
            Es una dirección privada: no la compartas.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <a href={feed.replace(/^https?:/, "webcal:")} className={ghostButtonClass}>Añadir al iPhone / Mac</a>
            <a href={`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(feed.replace(/^https?:/, "webcal:"))}`} target="_blank" rel="noreferrer" className={ghostButtonClass}>Añadir a Google Calendar</a>
          </div>
        </Card>
      )}
    </>
  );
}
