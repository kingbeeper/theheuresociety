import Link from "next/link";
import { connection } from "next/server";
import { requireUser } from "@/lib/admin-auth";
import { can } from "@/lib/crm-perms";
import { serialHistory } from "@/lib/serials";
import { Card, fieldClass, ghostButtonClass, PageTitle } from "@/components/admin/ui";

export const metadata = { title: "Historial por serial" };

// Todo lo que pasó con un número de serie: entradas, ventas, devoluciones y documentos
export default async function SerialPage({ searchParams }: PageProps<"/admin/inventario/serial">) {
  await connection();
  const user = await requireUser("inventario");
  const sp = await searchParams;
  const s = typeof sp.s === "string" ? sp.s.trim() : "";
  const rows = s ? await serialHistory(s, { showSuppliers: can(user, "costos") }) : [];

  return (
    <>
      <Link href="/admin/inventario" className="text-[0.66rem] tracking-[0.2em] uppercase text-stone hover:text-ivory">← Inventario</Link>
      <PageTitle eyebrow="Inventario" title="Historial por serial" />
      <form className="flex max-w-xl gap-2">
        <input name="s" defaultValue={s} placeholder="Número de serie (ej. 7K3P9921)" autoComplete="off" autoFocus className={fieldClass} />
        <button className={ghostButtonClass}>Buscar</button>
      </form>
      <p className="mt-2 text-xs text-stone">Da igual mayúsculas, espacios o guiones. Se guarda todo lo que pasó por el sistema: entradas (compra, consignación, memo, intercambio), ventas, devoluciones y documentos firmados o emitidos.</p>

      {s && (
        <Card className="mt-6" title={rows.length ? `⚠️ ${rows.length} registro(s) con este serial` : "Sin registros"}>
          {rows.length ? (
            <ol className="space-y-3 text-sm">
              {rows.map((r, i) => (
                <li key={i} className="border-b border-line/60 pb-3">
                  <p>
                    <span className="tabular-nums text-stone">{r.event_date}</span> · <b>{r.label}</b>
                    {r.party ? ` · ${r.party}` : ""}
                  </p>
                  <p className="text-xs text-stone">
                    {r.watch}
                    {r.item_id && r.sku ? <> · <Link href={`/admin/inventario/${r.item_id}`} className="underline hover:text-ivory">{r.sku}</Link></> : null}
                    {r.document_id && r.doc_number ? <> · <Link href={`/admin/documentos/${r.document_id}`} className="underline hover:text-ivory">{r.doc_number}</Link></> : null}
                    {" · "}serial {r.serial}
                  </p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-stone">Este serial no ha pasado nunca por el sistema.</p>
          )}
        </Card>
      )}
    </>
  );
}
