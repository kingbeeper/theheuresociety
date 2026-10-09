import Link from "next/link";
import { connection } from "next/server";
import { adminDb } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";
import { SOURCE_LABEL, STAGES, STAGE_LABEL, type Customer } from "@/lib/crm";
import { ago, Card, fmtDateTime, PageTitle, SourceTag, StageBadge, requestTime } from "@/components/admin/ui";

export const metadata = { title: "Panel" };

export default async function Dashboard() {
  await connection();
  // La plantilla y la página se generan en paralelo: cada página comprueba la sesión antes de leer datos
  await requireAdmin();
  const db = adminDb();
  const now = requestTime();
  const weekAgo = new Date(now - 7 * 86_400_000).toISOString();
  const nowIso = new Date(now).toISOString();

  const [customers, recent, appointments, sells, waiting, alerts] = await Promise.all([
    db.from("customers").select("stage, source, created_at"),
    db.from("customers").select("*").order("created_at", { ascending: false }).limit(6),
    db.from("appointments").select("id, kind, starts_at, name, status, customer_id").in("status", ["requested", "confirmed"]).gte("starts_at", nowIso).order("starts_at").limit(6),
    db.from("sell_requests").select("id, kind, brand, model, reference, name, created_at, customer_id").eq("status", "new").order("created_at", { ascending: false }).limit(5),
    db.from("wa_contacts").select("wa_id, name, customer_id, human_until").eq("mode", "human").gt("human_until", nowIso),
    db.from("watch_alerts").select("id", { count: "exact", head: true }).eq("active", true),
  ]);

  const all = (customers.data ?? []) as Pick<Customer, "stage" | "source" | "created_at">[];
  const week = all.filter((c) => c.created_at >= weekAgo);
  const bySource = Object.entries(
    week.reduce<Record<string, number>>((acc, c) => ({ ...acc, [c.source]: (acc[c.source] ?? 0) + 1 }), {})
  ).sort((a, b) => b[1] - a[1]);
  const byStage = STAGES.map((s) => [s, all.filter((c) => c.stage === s).length] as const);
  const open = all.filter((c) => c.stage !== "won" && c.stage !== "lost").length;
  const won = all.filter((c) => c.stage === "won").length;

  const kpis = [
    { label: "Leads nuevos · 7 días", value: week.length, href: "/admin/leads?stage=new" },
    { label: "Leads abiertos", value: open, href: "/admin/leads" },
    { label: "Citas próximas", value: appointments.data?.length ?? 0, href: "/admin/citas" },
    { label: "Compras por responder", value: sells.data?.length ?? 0, href: "/admin/compras" },
    { label: "Chats esperando a una persona", value: waiting.data?.length ?? 0, href: "/admin/leads?bot=off" },
    { label: "Búsquedas activas", value: alerts.count ?? 0, href: "/admin/leads?alerts=1" },
  ];

  return (
    <>
      <PageTitle eyebrow="The Heure Society" title="Panel" />

      <div className="grid grid-cols-2 gap-px border border-line bg-line lg:grid-cols-6">
        {kpis.map((k) => (
          <Link key={k.label} href={k.href} className="bg-forest px-5 py-6 transition-colors hover:bg-moss">
            <p className="font-display text-4xl font-light">{k.value}</p>
            <p className="mt-2 text-[0.62rem] leading-snug tracking-[0.18em] uppercase text-stone">{k.label}</p>
          </Link>
        ))}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card title="Embudo de leads" href="/admin/leads">
          <ul className="space-y-2.5">
            {byStage.map(([s, n]) => (
              <li key={s}>
                <Link href={`/admin/leads?stage=${s}`} className="flex items-center gap-3 text-sm hover:text-brass">
                  <span className="w-28 shrink-0 text-stone">{STAGE_LABEL[s]}</span>
                  <span className="h-2 flex-1 bg-ink">
                    <span className="block h-full bg-brass/70" style={{ width: `${all.length ? Math.max((n / all.length) * 100, n ? 3 : 0) : 0}%` }} />
                  </span>
                  <span className="w-8 text-right tabular-nums">{n}</span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-5 text-xs text-stone">
            Conversión: {all.length ? Math.round((won / all.length) * 100) : 0}% de los leads han terminado en venta o compra.
          </p>
        </Card>

        <Card title="De dónde llegan · 7 días">
          {bySource.length ? (
            <ul className="space-y-2.5 text-sm">
              {bySource.map(([s, n]) => (
                <li key={s} className="flex justify-between border-b border-line/60 pb-2">
                  <span className="text-stone">{SOURCE_LABEL[s] ?? s}</span>
                  <span className="tabular-nums">{n}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-stone">Todavía no hay leads esta semana.</p>
          )}
        </Card>

        <Card title="Próximas citas" href="/admin/citas">
          {appointments.data?.length ? (
            <ul className="space-y-3 text-sm">
              {appointments.data.map((a) => (
                <li key={a.id} className="flex items-start justify-between gap-3 border-b border-line/60 pb-3">
                  <div>
                    <p>{fmtDateTime(a.starts_at as string)}</p>
                    <p className="text-xs text-stone">
                      {a.kind === "office" ? "Oficina" : "Videollamada"} · {a.status === "confirmed" ? "confirmada" : "pendiente de confirmar"}
                    </p>
                  </div>
                  {a.customer_id ? (
                    <Link href={`/admin/leads/${a.customer_id}`} className="text-right hover:text-brass">{a.name as string}</Link>
                  ) : (
                    <span className="text-right">{a.name as string}</span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-stone">No hay citas próximas.</p>
          )}
        </Card>

        <Card title="Leads recientes" href="/admin/leads" className="xl:col-span-2">
          {recent.data?.length ? (
            <ul className="divide-y divide-line/60">
              {(recent.data as Customer[]).map((c) => (
                <li key={c.id}>
                  <Link href={`/admin/leads/${c.id}`} className="grid grid-cols-[1fr_auto] items-center gap-3 py-3 hover:text-brass sm:grid-cols-[1.2fr_1fr_auto_auto]">
                    <span className="truncate">{c.name ?? c.phone ?? c.email ?? "Sin nombre"}</span>
                    <span className="hidden truncate text-sm text-stone sm:block">{c.interests ?? "—"}</span>
                    <SourceTag source={c.source} />
                    <StageBadge stage={c.stage} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-stone">Aún no hay leads. Llegarán desde la web, WhatsApp o los puedes añadir a mano.</p>
          )}
        </Card>

        <Card title="Relojes por responder" href="/admin/compras">
          {sells.data?.length ? (
            <ul className="space-y-3 text-sm">
              {sells.data.map((s) => (
                <li key={s.id} className="border-b border-line/60 pb-3">
                  <p>{[s.brand, s.model, s.reference].filter(Boolean).join(" ")}</p>
                  <p className="text-xs text-stone">
                    {{ sell: "Vender", trade: "Intercambio", consign: "Consignación" }[s.kind as string] ?? s.kind} · {s.name as string} · {ago(s.created_at as string, now)}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-stone">Nada pendiente.</p>
          )}
        </Card>
      </div>
    </>
  );
}
