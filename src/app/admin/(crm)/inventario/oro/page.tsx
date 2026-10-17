import Link from "next/link";
import { connection } from "next/server";
import { requireUser } from "@/lib/admin-auth";
import { tr } from "@/lib/admin-i18n";
import { goldChange, KARATS, meltValue, metalPrices, perGram } from "@/lib/gold";
import { Card, fieldClass, fmtDateTime, money, PageTitle } from "@/components/admin/ui";

export const metadata = { title: "Precio del oro" };

// Precio del oro del día y calculadora del valor del metal (peso × quilates), con lo que ofrecer al comprar
export default async function GoldPage({ searchParams }: PageProps<"/admin/inventario/oro">) {
  await connection();
  await requireUser("inventario");
  const sp = await searchParams;
  const prices = await metalPrices();
  const g = typeof sp.g === "string" ? sp.g : "";
  const k = typeof sp.k === "string" ? sp.k : "14k";
  const calc = prices && g ? meltValue(prices, /^\d+k$/i.test(k) ? `Oro ${k}` : k, g) : null;
  const change = prices ? goldChange(prices) : null;
  const gram = prices ? perGram(prices, "gold") : null;

  return (
    <>
      <Link href="/admin/inventario" className="text-[0.66rem] tracking-[0.2em] uppercase text-stone hover:text-ivory">{tr("← Inventario")}</Link>
      <PageTitle eyebrow="Inventario" title="Precio del oro" />
      {!prices ? (
        <p className="text-sm text-amber-200">{tr("No se pudo obtener el precio ahora. Prueba en unos minutos.")}</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Hoy">
            <p className="font-display text-3xl">{money(prices.gold)} <span className="text-sm text-stone">/ oz</span></p>
            {change != null && <p className={`mt-1 text-sm ${change >= 0 ? "text-emerald-200" : "text-red-200"}`}>{change >= 0 ? "▲" : "▼"} {Math.abs(change).toFixed(1)}% {tr("desde ayer")}</p>}
            <p className="mt-1 text-xs text-stone">{tr("Actualizado")}: {fmtDateTime(prices.at)} · {tr("plata")} {prices.silver ? money(prices.silver) : "—"} · {tr("platino")} {prices.platinum ? money(prices.platinum) : "—"} / oz</p>
            <table className="mt-4 w-full text-sm">
              <thead className="text-left text-[0.6rem] tracking-[0.18em] uppercase text-stone"><tr><th className="py-1 font-normal">{tr("Oro")}</th><th className="py-1 text-right font-normal">{tr("$ por gramo")}</th></tr></thead>
              <tbody className="divide-y divide-line/60">
                {KARATS.map((kt) => (
                  <tr key={kt}><td className="py-1.5">{kt}k</td><td className="py-1.5 text-right tabular-nums">{gram ? `$${((gram * kt) / 24).toFixed(2)}` : "—"}</td></tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Card title="Calculadora del valor del metal">
            <form className="flex flex-wrap items-end gap-2">
              <label><span className="mb-1 block text-xs text-stone">{tr("Peso (g)")}</span><input name="g" defaultValue={g} inputMode="decimal" className={`${fieldClass} w-28`} /></label>
              <label>
                <span className="mb-1 block text-xs text-stone">{tr("Metal")}</span>
                <select name="k" defaultValue={k} className={`${fieldClass} w-36`}>
                  {KARATS.map((kt) => <option key={kt} value={`${kt}k`}>{tr("Oro")} {kt}k</option>)}
                  <option value="Plata 925">{tr("Plata 925")}</option>
                  <option value="Platino">{tr("Platino")}</option>
                </select>
              </label>
              <button className="border border-line px-4 py-2.5 text-[0.66rem] tracking-[0.2em] uppercase text-stone hover:text-ivory">{tr("Calcular")}</button>
            </form>
            {calc && (
              <div className="mt-5 text-sm">
                <p>{tr("Valor del metal")}: <b className="font-display text-2xl">{money(calc.value)}</b></p>
                <p className="mt-2 text-stone">{tr("Para comprar al peso (sin contar piedras ni marca):")}</p>
                <p className="mt-1">{[70, 80, 90].map((pct) => `${pct}% → ${money((calc.value * pct) / 100)}`).join("  ·  ")}</p>
              </div>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
