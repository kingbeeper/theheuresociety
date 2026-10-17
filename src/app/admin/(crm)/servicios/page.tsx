import Link from "next/link";
import { connection } from "next/server";
import { requireUser } from "@/lib/admin-auth";
import { can } from "@/lib/crm-perms";
import { tr } from "@/lib/admin-i18n";
import { pickupMessage, serviceBoard } from "@/lib/service";
import { SERVICE_STATUS, type ServiceStatus } from "@/lib/doc-labels";
import { Card, fmtDate, ghostButtonClass, money, PageTitle } from "@/components/admin/ui";

export const metadata = { title: "Servicios" };

// Pulidos y reparaciones: lo que está en curso, lo que lleva días listo sin recoger, lo atrasado
// y cómo trabaja cada taller (últimos 90 días)
export default async function ServicesPage() {
  await connection();
  const user = await requireUser("documentos");
  const showCosts = can(user, "costos");
  const { open, waiting, late, shops } = await serviceBoard();
  const cols: ServiceStatus[] = ["received", "workshop", "ready"];
  const small = "border border-emerald-300/40 px-2.5 py-1 text-[0.6rem] tracking-[0.14em] uppercase text-emerald-200 hover:bg-emerald-300/10";

  return (
    <>
      <PageTitle eyebrow="CRM" title="Servicios" action={<Link href="/admin/documentos/nuevo?tipo=service" className={ghostButtonClass}>{tr("+ Orden de servicio")}</Link>} />

      {(waiting.some((w) => w.days >= 7) || late.length > 0) && (
        <div className="mb-6 grid gap-4 md:grid-cols-2">
          {waiting.some((w) => w.days >= 7) && (
            <Card title="⏳ Listas sin recoger (7+ días)">
              <ul className="divide-y divide-line/60 text-sm">
                {waiting.filter((w) => w.days >= 7).map(({ d, days }) => (
                  <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <Link href={`/admin/documentos/${d.id}`} className="hover:text-brass">{d.number} · {d.client_name}</Link>
                    <span className="flex items-center gap-2">
                      <span className="text-xs text-amber-200">{tr("{n} días", { n: days })}</span>
                      {d.client_phone && <a href={`https://wa.me/${d.client_phone.replace(/\D/g, "")}?text=${encodeURIComponent(pickupMessage(d, days))}`} target="_blank" rel="noreferrer" className={small}>{tr("📲 Recordar")}</a>}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {late.length > 0 && (
            <Card title="⏰ Atrasadas (pasó la fecha prometida)">
              <ul className="divide-y divide-line/60 text-sm">
                {late.map((d) => (
                  <li key={d.id} className="flex justify-between gap-2 py-2">
                    <Link href={`/admin/documentos/${d.id}`} className="hover:text-brass">{d.number} · {d.client_name}</Link>
                    <span className="text-xs text-red-200">{d.service?.provider ?? "—"} · {d.due_date ? fmtDate(`${d.due_date}T12:00:00`) : ""}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}

      <div className="mb-8 grid gap-4 lg:grid-cols-3">
        {cols.map((c) => {
          const list = open.filter((d) => d.service?.status === c);
          return (
            <Card key={c} title={`${tr(SERVICE_STATUS[c])} · ${list.length}`}>
              {list.length ? (
                <ul className="grid gap-2 text-sm">
                  {list.map((d) => (
                    <li key={d.id} className="border border-line/60 p-2.5">
                      <Link href={`/admin/documentos/${d.id}`} className="hover:text-brass">{d.number} · {d.client_name}</Link>
                      <p className="truncate text-xs text-stone">{d.service?.piece}</p>
                      <p className="text-xs text-stone">{[d.service?.provider, d.due_date && `${tr("Lista para")} ${fmtDate(`${d.due_date}T12:00:00`)}`, Number(d.total) ? money(Number(d.total)) : null].filter(Boolean).join(" · ")}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-stone">{tr("Nada.")}</p>
              )}
            </Card>
          );
        })}
      </div>

      <Card title="Por taller · 90 días">
        {shops.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="text-left text-[0.6rem] tracking-[0.18em] uppercase text-stone">
                <tr>
                  <th className="py-2 font-normal">{tr("Taller")}</th>
                  <th className="py-2 text-right font-normal">{tr("Trabajos")}</th>
                  <th className="py-2 text-right font-normal">{tr("Días de media")}</th>
                  <th className="py-2 text-right font-normal">{tr("Cobrado")}</th>
                  {showCosts && <th className="py-2 text-right font-normal">{tr("Costo")}</th>}
                  {showCosts && <th className="py-2 text-right font-normal">{tr("Margen")}</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {shops.map((s) => (
                  <tr key={s.name}>
                    <td className="py-2">{s.name}</td>
                    <td className="py-2 text-right">{s.count}{s.done !== s.count ? <span className="text-xs text-stone"> ({s.done} {tr("entregados")})</span> : null}</td>
                    <td className="py-2 text-right">{s.avgDays != null ? s.avgDays.toFixed(1) : "—"}</td>
                    <td className="py-2 text-right">{money(s.revenue)}</td>
                    {showCosts && <td className="py-2 text-right">{money(s.cost)}</td>}
                    {showCosts && <td className="py-2 text-right">{money(s.revenue - s.cost)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-stone">{tr("Todavía no hay órdenes de servicio.")}</p>
        )}
      </Card>
    </>
  );
}
