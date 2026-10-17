import Link from "next/link";
import { connection } from "next/server";
import { requireUser } from "@/lib/admin-auth";
import { can } from "@/lib/crm-perms";
import { tr } from "@/lib/admin-i18n";
import { holdDays, miamiToday, purchaseBook } from "@/lib/secondhand";
import { Card, fieldClass, fmtDate, money, PageTitle } from "@/components/admin/ui";
import { holdDaysAction } from "../../../inventory-actions";

export const metadata = { title: "Registro de compras" };

const minus = (iso: string, days: number) => new Date(Date.parse(`${iso}T12:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);

// Libro de compras de segunda mano: cada pieza comprada o recibida en intercambio, con su vendedor, su
// identificación y su retención (Florida, cap. 538). Se exporta a Excel para una inspección.
export default async function RegistryPage({ searchParams }: PageProps<"/admin/inventario/registro">) {
  await connection();
  const user = await requireUser("inventario");
  const showCosts = can(user, "costos");
  const sp = await searchParams;
  const today = miamiToday();
  const valid = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const from = valid(sp.desde) ?? minus(today, 90);
  const to = valid(sp.hasta) ?? today;
  const [rows, days] = await Promise.all([purchaseBook(from, to), holdDays()]);
  const held = rows.filter((r) => r.holdUntil && r.holdUntil > today);
  const missing = rows.filter((r) => !r.document || !r.idNumber);
  const small = "border border-line px-2.5 py-1 text-[0.6rem] tracking-[0.14em] uppercase text-stone hover:text-ivory";

  return (
    <>
      <Link href="/admin/inventario" className="text-[0.66rem] tracking-[0.2em] uppercase text-stone hover:text-ivory">{tr("← Inventario")}</Link>
      <PageTitle eyebrow="Inventario" title="Registro de compras" />
      <p className="mb-6 max-w-3xl text-sm text-stone">
        {tr("Cada pieza que compras (o recibes en intercambio) con su vendedor, su identificación y su contrato firmado. Lo que compras a un particular queda retenido unos días antes de poder venderse; a un dealer, no. Confirma los plazos y los datos exactos con tu abogado y la policía local.")}
      </p>

      <div className="mb-6 grid gap-4 md:grid-cols-2">
        <Card title="Retención de las compras a particulares">
          <form action={holdDaysAction} className="flex flex-wrap items-center gap-2 text-sm">
            <input name="days" defaultValue={days} inputMode="numeric" className="w-16 border border-line bg-ink/60 px-2 py-1 text-right" />
            <span className="text-stone">{tr("días sin poder venderse (0 = sin retención)")}</span>
            <button className={small}>{tr("Guardar")}</button>
          </form>
          <p className="mt-3 text-sm">{held.length ? tr("{n} pieza(s) en retención ahora.", { n: held.length }) : tr("Ninguna pieza en retención ahora.")}</p>
          {missing.length > 0 && <p className="mt-1 text-sm text-amber-200">{tr("{n} compra(s) sin contrato o sin identificación del vendedor.", { n: missing.length })}</p>}
        </Card>
        <Card title="Exportar el libro">
          <form className="flex flex-wrap items-end gap-2 text-sm">
            <label><span className="mb-1 block text-xs text-stone">{tr("Desde")}</span><input type="date" name="desde" defaultValue={from} className={fieldClass} /></label>
            <label><span className="mb-1 block text-xs text-stone">{tr("Hasta")}</span><input type="date" name="hasta" defaultValue={to} className={fieldClass} /></label>
            <button className={small}>{tr("Ver")}</button>
            <a href={`/api/secondhand?desde=${from}&hasta=${to}`} download className={small}>{tr("⬇ Excel")}</a>
          </form>
        </Card>
      </div>

      {rows.length ? (
        <div className="overflow-x-auto border border-line">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-forest text-left text-[0.62rem] tracking-[0.2em] uppercase text-stone">
              <tr>
                <th className="px-4 py-3 font-normal">{tr("Fecha")}</th>
                <th className="px-4 py-3 font-normal">{tr("Pieza")}</th>
                {showCosts && <th className="px-4 py-3 text-right font-normal">{tr("Pagado")}</th>}
                <th className="px-4 py-3 font-normal">{tr("Vendedor")}</th>
                <th className="px-4 py-3 font-normal">{tr("Contrato")}</th>
                <th className="px-4 py-3 font-normal">{tr("Retención")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {rows.map((r) => {
                const inHold = r.holdUntil && r.holdUntil > today;
                return (
                  <tr key={r.id} className="align-top hover:bg-forest/60">
                    <td className="px-4 py-3 text-xs text-stone">{r.date ? fmtDate(`${r.date}T12:00:00`) : "—"}</td>
                    <td className="px-4 py-3">
                      <Link href={`/admin/inventario/${r.id}`} className="hover:text-brass">{r.sku} · {r.piece}</Link>
                      {r.serial && <p className="text-xs text-stone">{tr("Serial")}: {r.serial}</p>}
                    </td>
                    {showCosts && <td className="px-4 py-3 text-right">{r.paid != null ? money(r.paid) : "—"}</td>}
                    <td className="px-4 py-3">
                      {r.seller ?? "—"}
                      <p className="text-xs text-stone">{r.idNumber ? `${r.idType ?? ""} •••• ${r.idNumber.replace(/[^a-z0-9]/gi, "").slice(-4)}` : <span className="text-amber-200">{tr("sin identificación")}</span>}</p>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {r.document ? (
                        <div className="flex flex-wrap gap-2">
                          <Link href={`/admin/documentos/${r.document.id}`} className="text-brass hover:text-ivory">{r.document.number}</Link>
                          <span className={r.document.signed ? "text-emerald-200" : "text-amber-200"}>{r.document.signed ? tr("firmado") : tr("sin firmar")}</span>
                          {r.document.idPhoto && <a href={`/api/private/id/${r.document.id}`} target="_blank" rel="noreferrer" className="text-stone underline hover:text-ivory">{tr("ID")}</a>}
                          {r.details?.thumb_path && <a href={`/api/private/thumb/${r.document.id}`} target="_blank" rel="noreferrer" className="text-stone underline hover:text-ivory">{tr("Huella")}</a>}
                        </div>
                      ) : (
                        <Link href={`/admin/documentos/nuevo?tipo=purchase&reloj=${r.id}`} className="text-amber-200 hover:text-ivory">{tr("+ Contrato de compra")}</Link>
                      )}
                    </td>
                    <td className={`px-4 py-3 text-xs ${inHold ? "text-amber-200" : "text-stone"}`}>{r.holdUntil ? (inHold ? tr("hasta el {d}", { d: fmtDate(`${r.holdUntil}T12:00:00`) }) : tr("libre")) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="border border-line bg-forest/60 p-8 text-center text-sm text-stone">{tr("No hay compras en estas fechas.")}</p>
      )}
    </>
  );
}
