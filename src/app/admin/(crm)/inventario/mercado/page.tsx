import Link from "next/link";
import { connection } from "next/server";
import { requireUser } from "@/lib/admin-auth";
import { can } from "@/lib/crm-perms";
import { adminDb } from "@/lib/supabase";
import { priceVsMarket } from "@/lib/market";
import { isOwnerStock } from "@/lib/stock-labels";
import { totalCost, type Item } from "@/lib/stock";
import { tr } from "@/lib/admin-i18n";
import { Card, fmtDate, money, PageTitle } from "@/components/admin/ui";

export const metadata = { title: "Inventario frente al mercado" };

// Cuánto vale hoy el stock según el mercado (Chrono24, WatchCharts…, revisado cada 5 días), frente a
// nuestro precio y a lo que costó: qué está caro, qué está barato y la ganancia por realizar.
export default async function MarketPage() {
  await connection();
  const user = await requireUser("inventario");
  const showCosts = can(user, "costos");
  const { data } = await adminDb().from("inventory_items").select("*").in("status", ["in_stock", "reserved"]).order("market_checked_at", { ascending: false, nullsFirst: false });
  const items = (data ?? []) as Item[];
  const priced = items.filter((i) => i.market_typical);
  const rows = priced
    .map((i) => {
      const v = priceVsMarket({ asking_price: i.asking_price ?? null, market_low: i.market_low ?? null, market_high: i.market_high ?? null, market_typical: i.market_typical ?? null });
      const market = Number(i.market_typical);
      const ask = Number(i.asking_price ?? 0);
      // En consignación y memo lo que «cuesta» es lo que se paga al dueño al vender
      const cost = totalCost(i);
      return { i, v, market, ask, cost, owner: isOwnerStock(i.acquisition), gap: ask ? (ask - market) / market : null, profitAtMarket: cost ? market - cost : null };
    })
    .sort((a, b) => Math.abs(b.gap ?? 0) - Math.abs(a.gap ?? 0));
  const sum = (f: (r: (typeof rows)[number]) => number | null) => rows.reduce((a, r) => a + (f(r) ?? 0), 0);
  const marketTotal = sum((r) => r.market);
  const askTotal = sum((r) => r.ask || null);
  const costTotal = sum((r) => r.cost || null);
  const high = rows.filter((r) => r.v?.state === "high");
  const low = rows.filter((r) => r.v?.state === "low");
  const pending = items.length - priced.length;
  const tile = "border border-line px-4 py-3";
  const pct = (n: number | null) => (n == null ? "—" : `${n > 0 ? "+" : ""}${Math.round(n * 100)}%`);

  return (
    <>
      <Link href="/admin/inventario" className="text-[0.66rem] tracking-[0.2em] uppercase text-stone hover:text-ivory">{tr("← Inventario")}</Link>
      <PageTitle eyebrow="Inventario" title="Inventario frente al mercado" />
      <p className="mb-6 max-w-3xl text-sm text-stone">
        {tr("Precio típico de mercado de cada reloj en stock (anuncios de Chrono24, WatchCharts y otros dealers, revisados cada 5 días) frente a tu precio de venta y a lo que te costó.")}
        {pending > 0 && ` ${tr("Faltan {n} reloj(es) por revisar: se revisan solos.", { n: pending })}`}
      </p>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className={tile}><p className="text-[0.6rem] tracking-[0.2em] uppercase text-stone">{tr("Valor de mercado")}</p><p className="mt-1 text-xl">{money(marketTotal)}</p><p className="text-xs text-stone">{tr("{n} reloj(es) con precio de mercado", { n: rows.length })}</p></div>
        <div className={tile}><p className="text-[0.6rem] tracking-[0.2em] uppercase text-stone">{tr("Tu precio de venta")}</p><p className="mt-1 text-xl">{money(askTotal)}</p><p className="text-xs text-stone">{marketTotal && askTotal ? tr("{p} frente al mercado", { p: pct((askTotal - marketTotal) / marketTotal) }) : ""}</p></div>
        {showCosts && (
          <>
            <div className={tile}><p className="text-[0.6rem] tracking-[0.2em] uppercase text-stone">{tr("Costo (con gastos)")}</p><p className="mt-1 text-xl">{money(costTotal)}</p></div>
            <div className={tile}><p className="text-[0.6rem] tracking-[0.2em] uppercase text-stone">{tr("Ganancia a precio de mercado")}</p><p className={`mt-1 text-xl ${marketTotal - costTotal < 0 ? "text-red-200" : "text-emerald-200"}`}>{money(sum((r) => (r.cost ? r.market - r.cost : null)))}</p><p className="text-xs text-stone">{tr("por realizar (solo relojes con costo)")}</p></div>
          </>
        )}
      </div>

      <div className="mb-6 grid gap-4 md:grid-cols-2">
        <Card title={`⬆️ Por encima del mercado · ${high.length}`}>
          <p className="text-sm text-stone">{high.length ? tr("Pueden tardar en venderse: revisa el precio o resalta lo que los hace especiales (año, set completo, estado).") : tr("Ninguno.")}</p>
        </Card>
        <Card title={`⬇️ Por debajo del mercado · ${low.length}`}>
          <p className="text-sm text-stone">{low.length ? tr("Podrías pedir más por ellos (o se venderán rápido).") : tr("Ninguno.")}</p>
        </Card>
      </div>

      {rows.length ? (
        <div className="overflow-x-auto border border-line">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-forest text-left text-[0.62rem] tracking-[0.2em] uppercase text-stone">
              <tr>
                <th className="px-4 py-3 font-normal">{tr("Reloj")}</th>
                <th className="px-4 py-3 text-right font-normal">{tr("Tu precio")}</th>
                <th className="px-4 py-3 text-right font-normal">{tr("Mercado (típico)")}</th>
                <th className="px-4 py-3 text-right font-normal">{tr("Diferencia")}</th>
                {showCosts && <th className="px-4 py-3 text-right font-normal">{tr("Ganancia a mercado")}</th>}
                <th className="px-4 py-3 font-normal">{tr("Revisado")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {rows.map(({ i, v, market, ask, cost, owner, gap, profitAtMarket }) => (
                <tr key={i.id} className="hover:bg-forest/60">
                  <td className="px-4 py-3">
                    <Link href={`/admin/inventario/${i.id}`} className="hover:text-brass">{i.sku} · {[i.brand, i.model, i.reference].filter(Boolean).join(" ")}</Link>
                    {owner && <p className="text-xs text-stone">{tr("consignación / memo")}</p>}
                  </td>
                  <td className="px-4 py-3 text-right">{ask ? money(ask) : "—"}</td>
                  <td className="px-4 py-3 text-right">
                    {money(market)}
                    <p className="text-xs text-stone">{i.market_low ? money(Number(i.market_low)) : "?"} – {i.market_high ? money(Number(i.market_high)) : "?"}</p>
                  </td>
                  <td className={`px-4 py-3 text-right ${v?.state === "high" ? "text-amber-200" : v?.state === "low" ? "text-sky-200" : "text-stone"}`}>{pct(gap)}</td>
                  {showCosts && <td className={`px-4 py-3 text-right ${profitAtMarket != null && profitAtMarket < 0 ? "text-red-200" : ""}`}>{cost ? money(profitAtMarket) : <span className="text-xs text-stone">{tr("sin costo")}</span>}</td>}
                  <td className="px-4 py-3 text-xs text-stone">{i.market_checked_at ? fmtDate(i.market_checked_at) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="border border-line bg-forest/60 p-8 text-center text-sm text-stone">{tr("Todavía no hay relojes con precio de mercado. Se revisan solos (uno cada 10 minutos, cada reloj cada 5 días), o desde la ficha de cada reloj con «Revisar ahora».")}</p>
      )}
    </>
  );
}
