import Link from "next/link";
import { connection } from "next/server";
import { adminDb } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";
import { classify } from "@/lib/clients";
import { CUSTOMER_TAGS } from "@/lib/crm-labels";
import { type Customer } from "@/lib/crm";
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

  const [{ clients, values }, { data }] = await Promise.all([classify(), adminDb().from("customers").select("*").limit(5000)]);
  const all = ((data ?? []) as Customer[]).filter((c) => clients.has(c.id));
  const v = (id: string) => values.get(id);
  let rows = all.filter((c) => {
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
    const p = new URLSearchParams({ ...(q && { q }), ...(tag && { etiqueta: tag }), ...(vipOnly && { vip: "1" }), ...(order !== "gasto" && { orden: order }), ...patch });
    for (const [k, val] of [...p.entries()]) if (!val) p.delete(k);
    return `/admin/clientes${p.size ? `?${p}` : ""}`;
  };
  const chip = (on: boolean) => `self-center border px-2.5 py-1 text-[0.6rem] tracking-[0.14em] uppercase ${on ? "border-brass text-brass" : "border-line text-stone hover:text-ivory"}`;

  return (
    <>
      <PageTitle
        eyebrow="CRM"
        title="Clientes"
        action={<Link href="/admin/leads" className="border border-line px-4 py-2.5 text-[0.66rem] tracking-[0.2em] uppercase text-stone hover:text-ivory">Ver leads →</Link>}
      />
      <p className="mb-5 max-w-3xl text-sm text-stone">
        Quien ya hizo negocio contigo: te compró, te vendió o consignó un reloj, o lo marcaste como <b>Ganado</b>. Un lead pasa aquí solo cuando compra. Los prospectos están en <Link href="/admin/leads" className="underline hover:text-ivory">Leads</Link> y los dealers en <Link href="/admin/dealers?ver=dealers" className="underline hover:text-ivory">Dealers</Link>.
      </p>

      <div className="mb-6 grid grid-cols-3 gap-3 md:max-w-xl">
        <div className="border border-line px-4 py-3"><p className="text-[0.6rem] tracking-[0.2em] uppercase text-stone">Clientes</p><p className="mt-1 text-xl">{all.length}</p></div>
        <div className="border border-line px-4 py-3"><p className="text-[0.6rem] tracking-[0.2em] uppercase text-stone">⭐ VIP</p><p className="mt-1 text-xl">{vips}</p></div>
        <div className="border border-line px-4 py-3"><p className="text-[0.6rem] tracking-[0.2em] uppercase text-stone">Han comprado</p><p className="mt-1 text-xl">{money(total)}</p></div>
      </div>

      <form className="mb-6 flex flex-wrap gap-3" action="/admin/clientes">
        {tag && <input type="hidden" name="etiqueta" value={tag} />}
        {vipOnly && <input type="hidden" name="vip" value="1" />}
        <input name="q" defaultValue={q} placeholder="Buscar nombre, teléfono, correo o interés…" className={`${fieldClass} max-w-md flex-1`} />
        <select name="orden" defaultValue={order} className={`${fieldClass} w-auto`}>
          <option value="gasto">Más compras ($)</option>
          <option value="reciente">Compra más reciente</option>
          <option value="nombre">Nombre (A–Z)</option>
        </select>
        <button className="border border-line px-4 text-[0.66rem] tracking-[0.2em] uppercase text-stone hover:text-ivory">Filtrar</button>
        <Link href={qs({ vip: vipOnly ? "" : "1" })} className={chip(vipOnly)}>⭐ VIP</Link>
        {CUSTOMER_TAGS.filter((t) => t !== "Dealer").map((t) => (
          <Link key={t} href={qs({ etiqueta: tag === t ? "" : t })} className={chip(tag === t)}>{t}</Link>
        ))}
        {(q || tag || vipOnly) && <Link href="/admin/clientes" className="self-center text-xs text-stone underline hover:text-ivory">Quitar filtros</Link>}
      </form>

      {rows.length ? (
        <div className="overflow-x-auto border border-line">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-forest text-left text-[0.62rem] tracking-[0.2em] uppercase text-stone">
              <tr>
                <th className="px-4 py-3 font-normal">Cliente</th>
                <th className="px-4 py-3 font-normal">Etiquetas</th>
                <th className="px-4 py-3 text-right font-normal">Compras</th>
                <th className="px-4 py-3 font-normal">Última compra</th>
                <th className="px-4 py-3 text-right font-normal">Nos vendió / consignó</th>
                <th className="px-4 py-3 font-normal">Actividad</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {rows.map((c) => {
                const x = v(c.id);
                return (
                  <tr key={c.id} className="hover:bg-forest/60">
                    <td className="px-4 py-3">
                      <Link href={`/admin/leads/${c.id}`} className="hover:text-brass">{x?.vip ? "⭐ " : ""}{c.name ?? "Sin nombre"}</Link>
                      <p className="text-xs text-stone">{[c.phone, c.email].filter(Boolean).join(" · ")}</p>
                    </td>
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
        <p className="border border-line bg-forest/60 p-8 text-center text-sm text-stone">{all.length ? "Ningún cliente coincide con estos filtros." : "Todavía no hay clientes: aparecen aquí cuando vendes un reloj a alguien (o lo marcas como Ganado)."}</p>
      )}
    </>
  );
}
