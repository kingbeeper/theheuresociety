import { tr, trParts } from "@/lib/admin-i18n";
import Link from "next/link";
import { connection } from "next/server";
import { adminDb } from "@/lib/supabase";
import { requireUser } from "@/lib/admin-auth";
import { can } from "@/lib/crm-perms";
import { followUpsDue, SOURCE_LABEL, STAGES, STAGE_LABEL, type Customer } from "@/lib/crm";
import { salesByChannel, type Item } from "@/lib/stock";
import { topCustomers } from "@/lib/customer-value";
import { miamiToUtc, todayInMiami } from "@/lib/booking";
import { openTasks } from "@/lib/staff-tasks";
import { completeTaskAction } from "../actions";
import { ago, Card, fmtDateTime, money, PageTitle, SourceTag, StageBadge, requestTime } from "@/components/admin/ui";

export const metadata = { title: "Panel" };

export default async function Dashboard({ searchParams }: PageProps<"/admin">) {
  await connection();
  // La plantilla y la página se generan en paralelo: cada página comprueba la sesión antes de leer datos
  const user = await requireUser();
  const showCosts = can(user, "costos");
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
  const [follow, stock] = await Promise.all([
    followUpsDue(now, todayInMiami(new Date(now))),
    db.from("inventory_items").select("*").eq("status", "sold"),
  ]);
  // «Hoy»: lo que hay que hacer ahora, con un botón para cada cosa
  const today = todayInMiami(new Date(now));
  const endOfToday = miamiToUtc(today, "23:59").toISOString();
  const startOfToday = miamiToUtc(today, "00:00").toISOString();
  const [myTasks, dueReminders, lateInvoices, staleStock] = await Promise.all([
    openTasks(user.email),
    db.from("reminders").select("id, body", { count: "exact" }).is("done_at", null).lte("due_at", endOfToday).order("due_at").limit(3),
    can(user, "documentos") ? db.from("documents").select("id", { count: "exact", head: true }).eq("kind", "invoice").eq("status", "sent").lt("due_date", today) : null,
    can(user, "inventario") ? db.from("inventory_items").select("id", { count: "exact", head: true }).eq("status", "in_stock").lt("purchase_date", new Date(now - 120 * 86_400_000).toISOString().slice(0, 10)) : null,
  ]);
  const tasksDue = myTasks.filter((t) => t.due_date && t.due_date <= today);
  const apptsToday = (appointments.data ?? []).filter((a) => (a.starts_at as string) <= endOfToday && (a.starts_at as string) >= startOfToday);
  const todo: { n: number; emoji: string; text: string; sub?: string; href: string; cta: string }[] = [
    { n: tasksDue.length, emoji: "✅", text: tr("{n} tareas para hoy o vencidas", { n: tasksDue.length }), sub: tasksDue[0]?.title, href: "/admin/tareas", cta: tr("Ver tareas") },
    { n: dueReminders.count ?? 0, emoji: "⏰", text: tr("{n} recordatorios para hoy o vencidos", { n: dueReminders.count ?? 0 }), sub: dueReminders.data?.[0]?.body as string | undefined, href: "/admin/tareas", cta: tr("Ver recordatorios") },
    { n: !can(user, "citas") ? 0 : apptsToday.length, emoji: "📅", text: tr("{n} citas hoy", { n: apptsToday.length }), sub: apptsToday[0] ? `${fmtDateTime(apptsToday[0].starts_at as string)} · ${apptsToday[0].name as string}` : undefined, href: "/admin/citas", cta: tr("Ver citas") },
    { n: !can(user, "leads") ? 0 : follow.length, emoji: "👤", text: tr("{n} clientes a los que dar seguimiento", { n: follow.length }), sub: follow[0]?.name ?? undefined, href: "/admin/leads?follow=1", cta: tr("Ver seguimientos") },
    { n: !can(user, "compras") ? 0 : sells.data?.length ?? 0, emoji: "🤲", text: tr("{n} ofertas de clientes sin responder", { n: sells.data?.length ?? 0 }), href: "/admin/compras", cta: tr("Ver ofertas") },
    { n: !can(user, "leads") ? 0 : waiting.data?.length ?? 0, emoji: "💬", text: tr("{n} chats esperando a una persona", { n: waiting.data?.length ?? 0 }), href: "/admin/leads?bot=off", cta: tr("Ver chats") },
    { n: lateInvoices?.count ?? 0, emoji: "💵", text: tr("{n} facturas vencidas sin cobrar", { n: lateInvoices?.count ?? 0 }), href: "/admin/cobros", cta: tr("Ver cobros") },
    { n: staleStock?.count ?? 0, emoji: "⌚", text: tr("{n} piezas llevan más de 4 meses en el inventario", { n: staleStock?.count ?? 0 }), href: "/admin/inventario", cta: tr("Ver inventario") },
  ].filter((x) => x.n > 0);
  const [channels, best] = await Promise.all([salesByChannel((stock.data ?? []) as Item[], now - 365 * 86_400_000), topCustomers(6)]);

  const all = (customers.data ?? []) as Pick<Customer, "stage" | "source" | "created_at">[];
  const week = all.filter((c) => c.created_at >= weekAgo);
  const bySource = Object.entries(
    week.reduce<Record<string, number>>((acc, c) => ({ ...acc, [c.source]: (acc[c.source] ?? 0) + 1 }), {})
  ).sort((a, b) => b[1] - a[1]);
  const byStage = STAGES.map((s) => [s, all.filter((c) => c.stage === s).length] as const);
  const won = all.filter((c) => c.stage === "won").length;

  const kpis = [
    { label: "Leads nuevos · 7 días", value: week.length, href: "/admin/leads?stage=new" },
    { label: "Seguimientos para hoy", value: follow.length, href: "/admin/leads?follow=1" },
    { label: "Citas próximas", value: appointments.data?.length ?? 0, href: "/admin/citas" },
    { label: "Ofertas por responder", value: sells.data?.length ?? 0, href: "/admin/compras" },
    { label: "Chats esperando a una persona", value: waiting.data?.length ?? 0, href: "/admin/leads?bot=off" },
    { label: "Búsquedas activas", value: alerts.count ?? 0, href: "/admin/leads?alerts=1" },
  ];

  return (
    <>
      <PageTitle eyebrow="The Heure Society" title="Panel" />
      {(await searchParams)["sin-permiso"] && (
        <p className="mb-6 border border-amber-300/40 bg-amber-300/5 p-4 text-sm">{tr("No tienes permiso para esa sección. Pídeselo a un administrador.")}</p>
      )}

      <Card title="☀️ Hoy" className="mb-6">
        {todo.length ? (
          <ul className="divide-y divide-line/60">
            {todo.map((x) => (
              <li key={x.href + x.emoji} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0 flex-1 text-sm">
                  <p><span aria-hidden>{x.emoji}</span> {x.text}</p>
                  {x.sub && <p className="truncate text-xs text-stone">{x.sub}</p>}
                </div>
                <Link href={x.href} className="whitespace-nowrap border border-line px-3 py-1.5 text-[0.62rem] tracking-[0.18em] uppercase text-brass hover:text-ivory">{x.cta} →</Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-stone">{tr("Todo al día. 🎉 No tienes nada pendiente para hoy.")}</p>
        )}
      </Card>

      <div className="grid grid-cols-2 gap-px border border-line bg-line lg:grid-cols-6">
        {kpis.map((k) => (
          <Link key={k.label} href={k.href} className="bg-forest px-5 py-6 transition-colors hover:bg-moss">
            <p className="font-display text-3xl font-light sm:text-4xl">{k.value}</p>
            <p className="mt-2 text-[0.62rem] leading-snug tracking-[0.18em] uppercase text-stone">{trParts(k.label)}</p>
          </Link>
        ))}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card title="Embudo de leads" href="/admin/leads">
          <ul className="space-y-2.5">
            {byStage.map(([s, n]) => (
              <li key={s}>
                <Link href={`/admin/leads?stage=${s}`} className="flex items-center gap-3 text-sm hover:text-brass">
                  <span className="w-28 shrink-0 text-stone">{tr(STAGE_LABEL[s])}</span>
                  <span className="h-2 flex-1 bg-ink">
                    <span className="block h-full bg-brass/70" style={{ width: `${all.length ? Math.max((n / all.length) * 100, n ? 3 : 0) : 0}%` }} />
                  </span>
                  <span className="w-8 text-right tabular-nums">{n}</span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-5 text-xs text-stone">
            {tr("Conversión:")} {all.length ? Math.round((won / all.length) * 100) : 0}{tr("% de los leads han terminado en venta o compra.")}
          </p>
        </Card>

        <Card title="De dónde llegan · 7 días">
          {bySource.length ? (
            <ul className="space-y-2.5 text-sm">
              {bySource.map(([s, n]) => (
                <li key={s} className="flex justify-between border-b border-line/60 pb-2">
                  <span className="text-stone">{tr(SOURCE_LABEL[s] ?? s)}</span>
                  <span className="tabular-nums">{n}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-stone">{tr("Todavía no hay leads esta semana.")}</p>
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
                      {a.kind === "office" ? tr("Oficina") : tr("Videollamada")} · {a.status === "confirmed" ? "confirmada" : tr("pendiente de confirmar")}
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
            <p className="text-sm text-stone">{tr("No hay citas próximas.")}</p>
          )}
        </Card>

        <Card title="Seguimientos para hoy" href="/admin/leads?follow=1">
          {follow.length ? (
            <ul className="space-y-3 text-sm">
              {follow.slice(0, 8).map((f) => (
                <li key={f.taskId ?? f.id} className="border-b border-line/60 pb-3">
                  <Link href={`/admin/leads/${f.id}`} className="hover:text-brass">{f.taskId ? "⭐" : f.scheduled ? "⏰" : "💤"} {f.name ?? tr("Sin nombre")}</Link>
                  <p className="text-xs text-stone">{f.reason}</p>
                  {f.taskId && (
                    <div className="mt-1.5 flex gap-3 text-[0.62rem] tracking-[0.16em] uppercase">
                      {f.wa && <a href={f.wa} target="_blank" rel="noreferrer" className="text-brass hover:text-ivory">{tr("WhatsApp")}</a>}
                      <form action={completeTaskAction.bind(null, f.taskId)}><button className="text-stone hover:text-ivory">{tr("✓ Hecho")}</button></form>
                    </div>
                  )}
                </li>
              ))}
              {follow.length > 8 && <li className="text-xs text-stone">{tr("…y")} {follow.length - 8} {tr("más")}</li>}
            </ul>
          ) : (
            <p className="text-sm text-stone">{tr("Todo al día.")}</p>
          )}
        </Card>

        <Card title="Mejores clientes" href="/admin/clientes?vip=1">
          {best.length ? (
            <ul className="space-y-2.5 text-sm">
              {best.map((b, i) => (
                <li key={b.id} className="flex items-baseline justify-between gap-3 border-b border-line/60 pb-2">
                  <Link href={`/admin/leads/${b.id}`} className="min-w-0 truncate hover:text-brass">
                    <span className="text-stone">{i + 1}.</span> {b.vip ? "⭐ " : ""}{b.name ?? tr("Sin nombre")}
                  </Link>
                  <span className="shrink-0 tabular-nums text-stone">{money(b.spent)} · {b.purchases}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-stone">{tr("Aparecerán al registrar ventas con comprador en el inventario.")}</p>
          )}
        </Card>

        {showCosts && (
        <Card title="Ventas por canal · 12 meses" href="/admin/inventario?status=sold" className="xl:col-span-2">
          {channels.length ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[0.6rem] tracking-[0.16em] uppercase text-stone">
                  <th className="pb-2 font-normal">{tr("Canal del comprador")}</th>
                  <th className="pb-2 text-right font-normal">{tr("Ventas")}</th>
                  <th className="pb-2 text-right font-normal">{tr("Facturado")}</th>
                  <th className="pb-2 text-right font-normal">{tr("Ganancia")}</th>
                </tr>
              </thead>
              <tbody>
                {channels.map((r) => (
                  <tr key={r.source} className="border-t border-line/60">
                    <td className="py-2">{r.source === "unknown" ? tr("Sin comprador en el CRM") : tr(SOURCE_LABEL[r.source] ?? r.source)}</td>
                    <td className="py-2 text-right tabular-nums">{r.count}</td>
                    <td className="py-2 text-right tabular-nums">{money(r.revenue)}</td>
                    <td className="py-2 text-right tabular-nums">{money(r.profit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-stone">{tr("Aún no hay ventas registradas en el inventario. Al registrar una venta, el canal sale del origen del comprador.")}</p>
          )}
        </Card>
        )}

        <Card title="Leads recientes" href="/admin/leads" className="xl:col-span-2">
          {recent.data?.length ? (
            <ul className="divide-y divide-line/60">
              {(recent.data as Customer[]).map((c) => (
                <li key={c.id}>
                  <Link href={`/admin/leads/${c.id}`} className="grid grid-cols-[1fr_auto] items-center gap-3 py-3 hover:text-brass sm:grid-cols-[1.2fr_1fr_auto_auto]">
                    <span className="truncate">{c.name ?? c.phone ?? c.email ?? tr("Sin nombre")}</span>
                    <span className="hidden truncate text-sm text-stone sm:block">{c.interests ?? "—"}</span>
                    <SourceTag source={c.source} />
                    <StageBadge stage={c.stage} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-stone">{tr("Aún no hay leads. Llegarán desde la web, WhatsApp o los puedes añadir a mano.")}</p>
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
            <p className="text-sm text-stone">{tr("Nada pendiente.")}</p>
          )}
        </Card>
      </div>
    </>
  );
}
