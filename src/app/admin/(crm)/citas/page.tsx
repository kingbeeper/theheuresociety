import Link from "next/link";
import { connection } from "next/server";
import { adminDb } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";
import { getWatches } from "@/lib/inventory";
import { fmtDateTime, ghostButtonClass, PageTitle, requestTime } from "@/components/admin/ui";
import { setAppointmentStatus } from "../../actions";

export const metadata = { title: "Citas" };

const STATUS = { requested: "Pendiente de confirmar", confirmed: "Confirmada", cancelled: "Cancelada" } as const;

export default async function CitasPage() {
  await connection();
  // La plantilla y la página se generan en paralelo: cada página comprueba la sesión antes de leer datos
  await requireAdmin();
  const db = adminDb();
  const since = new Date(requestTime() - 30 * 86_400_000).toISOString();
  const [{ data }, watches] = await Promise.all([
    db.from("appointments").select("*").gte("starts_at", since).order("starts_at"),
    getWatches(),
  ]);
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
          <p className="text-xs text-stone">{a.kind === "office" ? "Oficina" : "Videollamada"} · {a.source === "web" ? "web" : "WhatsApp"}</p>
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
      <section className="border border-line bg-forest/60 px-5">
        <h2 className="pt-5 text-[0.66rem] tracking-[0.24em] uppercase text-stone">Próximas</h2>
        {upcoming.length ? <ul>{upcoming.map((a) => row(a, true))}</ul> : <p className="py-6 text-sm text-stone">No hay citas próximas.</p>}
      </section>
      <section className="mt-6 border border-line bg-forest/40 px-5">
        <h2 className="pt-5 text-[0.66rem] tracking-[0.24em] uppercase text-stone">Últimos 30 días y canceladas</h2>
        {past.length ? <ul>{past.map((a) => row(a, false))}</ul> : <p className="py-6 text-sm text-stone">Nada todavía.</p>}
      </section>
    </>
  );
}
