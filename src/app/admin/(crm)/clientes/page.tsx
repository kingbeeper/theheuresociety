import { tr } from "@/lib/admin-i18n";
import Link from "next/link";
import { connection } from "next/server";
import { adminDb } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";
import { classify } from "@/lib/clients";
import { CUSTOMER_TAGS } from "@/lib/crm-labels";
import { type Customer } from "@/lib/crm";
import { REGIONS, isRegion, regionOf, type Region } from "@/lib/regions";
import { lastAddresses } from "@/lib/region-data";
import { saveGuessedRegionsAction } from "../../actions";
import { ago, fieldClass, fmtDate, money, PageTitle, requestTime } from "@/components/admin/ui";

export const metadata = { title: "Clientes" };

// Base de datos de clientes: solo quien ya hizo negocio con nosotros (compró, nos vendió o consignó,
// o está en «Ganado»). Los prospectos están en Leads y los dealers en su propia sección.
export default async function ClientsPage({ searchParams }: PageProps<"/admin/clientes">) {
  await connection();
  await requireAdmin("leads");
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const q = one(sp.q).trim().toLowerCase();
  const tag = one(sp.etiqueta);
  const vipOnly = one(sp.vip) === "1";
  const order = one(sp.orden) || "gasto";
  const regionParam = one(sp.region);
  const region = isRegion(regionParam) || regionParam === "sin" ? regionParam : "";

  const [{ clients, values }, { data }, addresses] = await Promise.all([classify(), adminDb().from("customers").select("*").limit(5000), lastAddresses()]);
  const all = ((data ?? []) as Customer[]).filter((c) => clients.has(c.id));
  const v = (id: string) => values.get(id);
  const reg = new Map(all.map((c) => [c.id, regionOf(c, addresses.get(c.id))]));
  const regionCount = (r: Region | "sin") => all.filter((c) => (reg.get(c.id)?.region ?? "sin") === r).length;
  const guessedCount = all.filter((c) => reg.get(c.id)?.guessed && reg.get(c.id)?.region).length;
  let rows = all.filter((c) => {
    if (region && (reg.get(c.id)?.region ?? "sin") !== region) return false;
    if (vipOnly && !v(c.id)?.vip) return false;
    if (tag && !(c.tags ?? []).some((t) => t.toLowerCase() === tag.toLowerCase())) return false;
    if (q && ![c.name, c.phone, c.email, c.interests, ...(c.tags ?? [])].some((x) => x?.toLowerCase().includes(q))) return false;
    return true;
  });
  rows = rows.sort((a, b) =>
    order === "nombre" ? (a.name ?? "").localeCompare(b.name ?? "")
    : order === "reciente" ? (v(b.id)?.lastPurchase ?? b.last_activity_at).localeCompare(v(a.id)?.lastPurchase ?? a.last_activity_at)
    : (v(b.id)?.spent ?? 0) - (v(a.id)?.spent ?? 0)
  );
  const total = all.reduce((s, c) => s + (v(c.id)?.spent ?? 0), 0);
  const vips = all.filter((c) => v(c.id)?.vip).length;
  const now = requestTime();
  const qs = (patch: Record<string, string>) => {
    const p = new URLSearchParams({ ...(q && { q }), ...(tag && { etiqueta: tag }), ...(vipOnly && { vip: "1" }), ...(order !== "gasto" && { orden: order }), ...(region && { region }), ...patch });
    for (const [k, val] of [...p.entries()]) if (!val) p.delete(k);
    return `/admin/clientes${p.size ? `?${p}` : ""}`;
  };
  const chip = (on: boolean) => `self-center border px-2.5 py-1 text-[0.6rem] tracking-[0.14em] uppercase ${on ? "border-brass text-brass" : "border-line text-stone hover:text-ivory"}`;

  return (
    <>
      <PageTitle eyebrow="Contactos" title="Clientes" />
      <p className="mb-5 text-sm text-stone">{tr("Quien ya te compró, te vendió o consignó.")}</p>

      <div className="mb-6 grid grid-cols-3 gap-3 md:max-w-xl">
        <div className="border border-line px-4 py-3"><p className="text-[0.6rem] tracking-[0.2em] uppercase text-stone">{tr("Clientes")}</p><p className="mt-1 text-xl">{all.length}</p></div>
        <div className="border border-line px-4 py-3"><p className="text-[0.6rem] tracking-[0.2em] uppercase text-stone">{tr("⭐ VIP")}</p><p className="mt-1 text-xl">{vips}</p></div>
        <div className="border border-line px-4 py-3"><p className="text-[0.6rem] tracking-[0.2em] uppercase text-stone">{tr("Han comprado")}</p><p className="mt-1 text-xl">{money(total)}</p></div>
      </div>

      <form className="mb-6 flex flex-wrap gap-3" action="/admin/clientes">
        {tag && <input type="hidden" name="etiqueta" value={tag} />}
        {vipOnly && <input type="hidden" name="vip" value="1" />}
        {region && <input type="hidden" name="region" value={region} />}
        <input name="q" defaultValue={q} placeholder={tr("Buscar nombre, teléfono, correo o interés…")} className={`${fieldClass} max-w-md flex-1`} />
        <select name="orden" defaultValue={order} className={`${fieldClass} w-auto`}>
          <option value="gasto">{tr("Más compras ($)")}</option>
          <option value="reciente">{tr("Compra más reciente")}</option>
          <option value="nombre">{tr("Nombre (A–Z)")}</option>
        </select>
        <button className="border border-line px-4 text-[0.66rem] tracking-[0.2em] uppercase text-stone hover:text-ivory">{tr("Filtrar")}</button>
        <Link href={qs({ vip: vipOnly ? "" : "1" })} className={chip(vipOnly)}>{tr("⭐ VIP")}</Link>
        {CUSTOMER_TAGS.filter((t) => t !== "Dealer").map((t) => (
          <Link key={t} href={qs({ etiqueta: tag === t ? "" : t })} className={chip(tag === t)}>{t}</Link>
        ))}
        {(q || tag || vipOnly || region) && <Link href="/admin/clientes" className="self-center text-xs text-stone underline hover:text-ivory">{tr("Quitar filtros")}</Link>}
      </form>

      {/* Por región: para enviar ofertas y correos a cada zona */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <span className="text-[0.6rem] tracking-[0.2em] uppercase text-stone">{tr("Región")}</span>
        {(Object.keys(REGIONS) as Region[]).map((r) => (
          <Link key={r} href={qs({ region: region === r ? "" : r })} className={chip(region === r)}>{tr(REGIONS[r])} · {regionCount(r)}</Link>
        ))}
        {regionCount("sin") > 0 && <Link href={qs({ region: region === "sin" ? "" : "sin" })} className={chip(region === "sin")}>{tr("Sin región")} · {regionCount("sin")}</Link>}
        <a href={`/api/clients/export${region ? `?region=${region}` : ""}`} download className="ml-auto self-center border border-line px-3 py-1.5 text-[0.6rem] tracking-[0.14em] uppercase text-stone hover:text-ivory">{tr("⬇ Exportar {n} (Excel)", { n: region ? regionCount(region as Region | "sin") : all.length })}</a>
        {region && region !== "sin" && <Link href={`/admin/correos?region=${region}`} className="self-center border border-line px-3 py-1.5 text-[0.6rem] tracking-[0.14em] uppercase text-stone hover:text-ivory">{tr("✉️ Correo a esta región")}</Link>}
      </div>
      {guessedCount > 0 && (
        <form action={saveGuessedRegionsAction} className="mb-6 flex flex-wrap items-center gap-3 text-xs text-stone">
          <span>{tr("{n} clientes tienen la región sugerida por su teléfono o dirección (en gris). Revísala en su ficha o guárdalas todas:", { n: guessedCount })}</span>
          <button className="border border-line px-3 py-1.5 text-[0.6rem] tracking-[0.14em] uppercase hover:text-ivory">{tr("Guardar las sugeridas")}</button>
        </form>
      )}

      {rows.length ? (
        <div className="overflow-x-auto border border-line">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-forest text-left text-[0.62rem] tracking-[0.2em] uppercase text-stone">
              <tr>
                <th className="px-4 py-3 font-normal">{tr("Cliente")}</th>
                <th className="px-4 py-3 font-normal">{tr("Región")}</th>
                <th className="px-4 py-3 font-normal">{tr("Etiquetas")}</th>
                <th className="px-4 py-3 text-right font-normal">{tr("Compras")}</th>
                <th className="px-4 py-3 font-normal">{tr("Última compra")}</th>
                <th className="px-4 py-3 text-right font-normal">{tr("Nos vendió / consignó")}</th>
                <th className="px-4 py-3 font-normal">{tr("Actividad")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {rows.map((c) => {
                const x = v(c.id);
                return (
                  <tr key={c.id} className="hover:bg-forest/60">
                    <td className="px-4 py-3">
                      <Link href={`/admin/leads/${c.id}`} className="hover:text-brass">{x?.vip ? "⭐ " : ""}{c.name ?? tr("Sin nombre")}</Link>
                      <p className="text-xs text-stone">{[c.phone, c.email].filter(Boolean).join(" · ")}</p>
                    </td>
                    <td className={`px-4 py-3 text-xs ${reg.get(c.id)?.guessed ? "text-stone/70 italic" : ""}`}>{(() => { const r = reg.get(c.id)?.region; return r ? tr(REGIONS[r]) : "—"; })()}</td>
                    <td className="px-4 py-3 text-xs text-stone">{c.tags?.length ? c.tags.join(", ") : "—"}</td>
                    <td className="px-4 py-3 text-right">{x?.purchases ? <>{money(x.spent)}<p className="text-xs text-stone">{x.purchases} reloj{x.purchases > 1 ? "es" : ""}</p></> : "—"}</td>
                    <td className="px-4 py-3 text-xs text-stone">{x?.lastPurchase ? fmtDate(x.lastPurchase) : "—"}</td>
                    <td className="px-4 py-3 text-right">{x?.supplied || "—"}</td>
                    <td className="px-4 py-3 text-xs text-stone">{ago(c.last_activity_at, now)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="border border-line bg-forest/60 p-8 text-center text-sm text-stone">{all.length ? tr("Ningún cliente coincide con estos filtros.") : tr("Todavía no hay clientes: aparecen aquí cuando vendes un reloj a alguien (o lo marcas como Ganado).")}</p>
      )}
    </>
  );
}
