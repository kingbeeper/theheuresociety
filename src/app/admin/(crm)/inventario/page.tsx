import Link from "next/link";
import { connection } from "next/server";
import { adminDb } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";
import { daysInStock, margin, summarize, type Item } from "@/lib/stock";
import { ACQUISITION, ITEM_STATUS, isOwnerStock } from "@/lib/stock-labels";
import { buttonClass, Card, fieldClass, fmtDate, ghostButtonClass, money, PageTitle, requestTime } from "@/components/admin/ui";
import { ImportInventory } from "@/components/admin/ImportInventory";

export const metadata = { title: "Inventario" };

const STATUS_STYLE: Record<string, string> = {
  in_stock: "text-emerald-200",
  reserved: "text-amber-200",
  sold: "text-brass",
  returned: "text-stone",
};

export default async function InventarioPage({ searchParams }: PageProps<"/admin/inventario">) {
  await connection();
  await requireAdmin();
  const sp = await searchParams;
  const tab = typeof sp.status === "string" ? sp.status : "available";
  const q = typeof sp.q === "string" ? sp.q.trim().toLowerCase() : "";
  const now = requestTime();

  const { data } = await adminDb().from("inventory_items").select("*").order("purchase_date", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false });
  const items = (data ?? []) as Item[];
  const s = summarize(items, now);

  const list = items
    .filter((i) =>
      tab === "all" ? true
      : tab === "available" ? i.status === "in_stock" || i.status === "reserved"
      : tab === "aged" ? (i.status === "in_stock" || i.status === "reserved") && (daysInStock(i, now) ?? 0) > 90
      : tab === "owed" ? s.owed.some((o) => o.id === i.id)
      : i.status === tab
    )
    .filter((i) => !q || [i.sku, i.brand, i.model, i.reference, i.serial, i.supplier_name, i.supplier_company, i.buyer_name].some((v) => v?.toLowerCase().includes(q)));

  const count = (f: (i: Item) => boolean) => items.filter(f).length;
  const tabs: [string, string, number][] = [
    ["available", "Disponibles", count((i) => i.status === "in_stock" || i.status === "reserved")],
    ["sold", "Vendidos", count((i) => i.status === "sold")],
    ["returned", "Devueltos", count((i) => i.status === "returned")],
    ["aged", "+90 días", s.aged.length],
    ["owed", "A pagar a dueños", s.owed.length],
    ["all", "Todos", items.length],
  ];

  const kpis = [
    { label: "Relojes disponibles", value: String(s.inStock), sub: s.consignedCount ? `${s.consignedCount} en consignación/memo` : "" },
    { label: "Capital invertido", value: money(s.capital), sub: "costo + gastos del stock propio" },
    { label: "Valor a la venta", value: money(s.stockValue), sub: "precio previsto del stock" },
    { label: "Ventas del mes", value: money(s.salesMonth), sub: `${s.soldMonthCount} reloj(es)` },
    { label: "Ganancia del mes", value: money(s.profitMonth), sub: "venta − costo − gastos" },
    { label: "Margen medio · 90 d", value: s.avgMargin == null ? "—" : `${Math.round(s.avgMargin * 100)}%`, sub: s.avgDays == null ? "" : `se venden en ${s.avgDays} días de media` },
  ];

  return (
    <>
      <PageTitle
        eyebrow="CRM"
        title="Inventario"
        action={
          <div className="flex flex-wrap gap-2">
            <ImportInventory />
            {/* Descarga de archivo: enlace normal, no navegación de Next */}
            <a href="/api/inventory/export" download className={ghostButtonClass}>Exportar a Excel</a>
            <Link href="/admin/inventario/nuevo" className={buttonClass}>+ Añadir reloj</Link>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-px border border-line bg-line lg:grid-cols-6">
        {kpis.map((k) => (
          <div key={k.label} className="bg-forest px-5 py-5">
            <p className="font-display text-3xl font-light">{k.value}</p>
            <p className="mt-1 text-[0.6rem] tracking-[0.16em] uppercase text-stone">{k.label}</p>
            {k.sub && <p className="mt-1 text-xs text-stone/80">{k.sub}</p>}
          </div>
        ))}
      </div>

      {/* Avisos: lo que requiere atención */}
      {(s.aged.length > 0 || s.memoDue.length > 0 || s.owed.length > 0 || s.missingCost.length > 0) && (
        <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {s.owed.length > 0 && (
            <Link href="/admin/inventario?status=owed" className="border border-amber-300/40 bg-amber-300/5 p-4 text-sm hover:border-amber-200">
              💵 <b>{money(s.owedAmount)}</b> pendientes de pagar a dueños ({s.owed.length} venta/s de consignación o memo)
            </Link>
          )}
          {s.memoDue.length > 0 && (
            <div className="border border-red-300/40 bg-red-300/5 p-4 text-sm">⏳ {s.memoDue.length} memo(s) por devolver en 7 días o vencidos</div>
          )}
          {s.aged.length > 0 && (
            <Link href="/admin/inventario?status=aged" className="border border-line bg-forest/60 p-4 text-sm hover:border-brass/60">
              🕰 {s.aged.length} reloj(es) con más de 90 días en stock: revisa el precio
            </Link>
          )}
          {s.missingCost.length > 0 && (
            <div className="border border-line bg-forest/60 p-4 text-sm">✎ {s.missingCost.length} reloj(es) sin costo: complétalo para calcular el margen</div>
          )}
        </div>
      )}

      <Card className="mt-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-1 overflow-x-auto">
            {tabs.map(([k, l, n]) => (
              <Link
                key={k}
                href={`/admin/inventario?status=${k}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
                className={`whitespace-nowrap border-b-2 px-3 py-2 text-[0.64rem] tracking-[0.16em] uppercase ${tab === k ? "border-brass text-ivory" : "border-transparent text-stone hover:text-ivory"}`}
              >
                {l} <span className="text-stone/70">{n}</span>
              </Link>
            ))}
          </div>
          <form action="/admin/inventario" className="flex gap-2">
            <input type="hidden" name="status" value={tab} />
            <input name="q" defaultValue={q} placeholder="Buscar ref, serie, marca, cliente…" className={`${fieldClass} w-64`} />
          </form>
        </div>

        {list.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="text-left text-[0.6rem] tracking-[0.16em] uppercase text-stone">
                <tr>
                  <th className="pb-2 font-normal">SKU</th>
                  <th className="pb-2 font-normal">Reloj</th>
                  <th className="pb-2 font-normal">Entrada</th>
                  <th className="pb-2 text-right font-normal">Días</th>
                  <th className="pb-2 text-right font-normal">Costo</th>
                  <th className="pb-2 text-right font-normal">Precio</th>
                  <th className="pb-2 text-right font-normal">Venta</th>
                  <th className="pb-2 text-right font-normal">Margen</th>
                  <th className="pb-2 pl-4 font-normal">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {list.map((i) => {
                  const m = margin(i);
                  const d = daysInStock(i, now);
                  return (
                    <tr key={i.id} className="hover:bg-forest/60">
                      <td className="py-2.5 text-xs text-stone">
                        <Link href={`/admin/inventario/${i.id}`} className="hover:text-brass">{i.sku}</Link>
                      </td>
                      <td className="py-2.5 pr-3">
                        <Link href={`/admin/inventario/${i.id}`} className="hover:text-brass">{i.brand} {i.model ?? ""}</Link>
                        <p className="text-xs text-stone">{[i.reference && `Ref. ${i.reference}`, i.serial && `S/N ${i.serial}`].filter(Boolean).join(" · ")}</p>
                      </td>
                      <td className="py-2.5 text-xs">
                        {ACQUISITION[i.acquisition]}
                        <p className="text-stone">{i.purchase_date ? fmtDate(i.purchase_date) : "—"}</p>
                      </td>
                      <td className={`py-2.5 text-right tabular-nums ${(d ?? 0) > 90 && i.status !== "sold" ? "text-amber-200" : ""}`}>{d ?? "—"}</td>
                      <td className="py-2.5 text-right tabular-nums">{money(i.cost)}</td>
                      <td className="py-2.5 text-right tabular-nums">{money(i.asking_price)}</td>
                      <td className="py-2.5 text-right tabular-nums">{money(i.sale_price)}</td>
                      <td className="py-2.5 text-right tabular-nums">
                        {m ? <>{money(m.amount)}<span className="block text-xs text-stone">{m.onSale != null ? `${Math.round(m.onSale * 100)}%` : ""}</span></> : "—"}
                      </td>
                      <td className={`py-2.5 pl-4 text-xs ${STATUS_STYLE[i.status]}`}>
                        {ITEM_STATUS[i.status]}
                        {i.status === "sold" && isOwnerStock(i.acquisition) && !i.owner_paid_at && <span className="block text-amber-200">dueño sin pagar</span>}
                        {i.status === "sold" && i.buyer_name && <span className="block text-stone">{i.buyer_name}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="py-8 text-center text-sm text-stone">
            {items.length ? "Nada con estos filtros." : "El inventario está vacío. Añade el primer reloj o importa la hoja de Excel."}
          </p>
        )}
      </Card>
    </>
  );
}
