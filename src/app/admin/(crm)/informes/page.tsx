import Link from "next/link";
import { connection } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { monthlyReport } from "@/lib/report";
import { todayInMiami } from "@/lib/booking";
import { buttonClass, Card, fieldClass, fmtDate, money, PageTitle, requestTime } from "@/components/admin/ui";

export const metadata = { title: "Informes" };

export default async function ReportsPage({ searchParams }: PageProps<"/admin/informes">) {
  await connection();
  await requireAdmin();
  const sp = await searchParams;
  const current = todayInMiami(new Date(requestTime())).slice(0, 7);
  const month = typeof sp.mes === "string" && /^\d{4}-\d{2}$/.test(sp.mes) ? sp.mes : current;
  const r = await monthlyReport(month);
  const t = r.totals;
  const label = new Intl.DateTimeFormat("es-ES", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-15T12:00:00Z`));
  const day = (iso: string) => fmtDate(`${iso}T12:00:00`);

  const kpis = [
    ["Ventas", money(t.revenue)],
    ["Ganancia bruta", money(t.profit)],
    ["Compras de stock", money(t.bought)],
    ["Pagado a dueños", money(t.ownerPaid)],
    ["Relojero", money(t.repairs)],
    ["Impuesto cobrado", money(t.taxCollected)],
  ];

  return (
    <>
      <PageTitle
        eyebrow="CRM"
        title={`Informe de ${label}`}
        action={
          <div className="flex flex-wrap items-end gap-2">
            <form action="/admin/informes" className="flex gap-2">
              <input type="month" name="mes" defaultValue={month} className={`${fieldClass} w-auto`} />
              <button className="border border-line px-4 text-[0.66rem] tracking-[0.2em] uppercase text-stone hover:text-ivory">Ver</button>
            </form>
            <a href={`/api/reports/monthly?mes=${month}`} download className={buttonClass}>Excel para el contador</a>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-px border border-line bg-line lg:grid-cols-6">
        {kpis.map(([l, v]) => (
          <div key={l} className="bg-forest px-5 py-5">
            <p className="break-words font-display text-2xl font-light sm:text-3xl">{v}</p>
            <p className="mt-1 text-[0.6rem] tracking-[0.16em] uppercase text-stone">{l}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card title={`Ventas · ${r.sales.length}`}>
          {r.sales.length ? (
            <ul className="space-y-2 text-sm">
              {r.sales.map((s) => (
                <li key={s.sku} className="flex justify-between gap-3 border-b border-line/60 pb-2">
                  <span className="min-w-0"><span className="text-stone">{day(s.date)} · {s.sku}</span> {s.watch}<span className="block text-xs text-stone">{s.buyer ?? "—"} · {s.payment ?? "—"}</span></span>
                  <span className="shrink-0 text-right tabular-nums">{money(s.price)}<span className="block text-xs text-stone">{s.profit == null ? "sin costo" : `+${money(s.profit)}`}</span></span>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-stone">Sin ventas este mes.</p>}
        </Card>

        <Card title={`Entradas al inventario · ${r.purchases.length}`}>
          {r.purchases.length ? (
            <ul className="space-y-2 text-sm">
              {r.purchases.map((p) => (
                <li key={p.sku} className="flex justify-between gap-3 border-b border-line/60 pb-2">
                  <span className="min-w-0"><span className="text-stone">{day(p.date)} · {p.sku}</span> {p.watch}<span className="block text-xs text-stone">{p.acquisition} · {p.supplier ?? "—"}</span></span>
                  <span className="shrink-0 tabular-nums">{p.owner ? <span className="text-xs text-stone">al vender</span> : money(p.cost)}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-stone">Sin entradas este mes.</p>}
        </Card>

        <Card title="Impuesto de ventas (Florida)">
          <dl className="grid grid-cols-[1fr_auto] gap-y-2 text-sm">
            <dt className="text-stone">Ventas con impuesto (base)</dt><dd className="text-right tabular-nums">{money(t.taxableSales)}</dd>
            <dt className="text-stone">Ventas exentas (facturas sin impuesto)</dt><dd className="text-right tabular-nums">{money(t.exemptSales)}</dd>
            <dt className="border-t border-line pt-2">Impuesto cobrado</dt><dd className="border-t border-line pt-2 text-right tabular-nums">{money(t.taxCollected)}</dd>
          </dl>
          <p className="mt-3 text-xs text-stone">
            Sale de las facturas pagadas en el mes. Las ventas registradas directamente en el inventario (sin factura) no llevan el detalle del impuesto:
            para que cuenten aquí, regístralas con una factura.
          </p>
        </Card>

        <Card title="Pagos a dueños y relojero">
          {r.owners.length || r.repairs.length ? (
            <ul className="space-y-2 text-sm">
              {r.owners.map((o) => (
                <li key={`o-${o.sku}`} className="flex justify-between gap-3 border-b border-line/60 pb-2">
                  <span>💵 <span className="text-stone">{day(o.date)} · {o.sku}</span> {o.owner ?? "Dueño"}</span><span className="tabular-nums">{money(o.amount)}</span>
                </li>
              ))}
              {r.repairs.map((s, i) => (
                <li key={`s-${i}`} className="flex justify-between gap-3 border-b border-line/60 pb-2">
                  <span>🔧 <span className="text-stone">{day(s.date)} · {s.sku}</span> {s.provider}</span><span className="tabular-nums">{money(s.cost)}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-stone">Nada este mes.</p>}
        </Card>
      </div>
      <p className="mt-6 text-xs text-stone">
        El Excel trae una hoja por apartado (resumen, ventas, compras, pagos a dueños, impuesto y relojero). <Link href="/admin/inventario" className="underline hover:text-ivory">Inventario completo →</Link>
      </p>
    </>
  );
}
