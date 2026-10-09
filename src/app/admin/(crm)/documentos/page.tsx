import Link from "next/link";
import { connection } from "next/server";
import { adminDb } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";
import { KIND_LABEL, KIND_PLURAL, STATUS_LABEL, STATUS_STYLE, usd, type Doc, type DocKind } from "@/lib/doc-labels";
import { todayInMiami } from "@/lib/booking";
import { buttonClass, fmtDate, ghostButtonClass, money, PageTitle, requestTime } from "@/components/admin/ui";

export const metadata = { title: "Documentos" };

export default async function DocumentsPage({ searchParams }: PageProps<"/admin/documentos">) {
  await connection();
  await requireAdmin("documentos");
  const sp = await searchParams;
  const tab = (typeof sp.tipo === "string" && sp.tipo in KIND_LABEL ? sp.tipo : "all") as DocKind | "all";
  const { data, error } = await adminDb().from("documents").select("*").order("created_at", { ascending: false }).limit(500);
  const docs = (data ?? []) as Doc[];
  const today = todayInMiami(new Date(requestTime()));
  const list = docs.filter((d) => tab === "all" || d.kind === tab);

  const unpaid = docs.filter((d) => d.kind === "invoice" && d.status === "sent");
  const overdue = unpaid.filter((d) => d.due_date && d.due_date < today);
  const memosOut = docs.filter((d) => d.kind === "memo" && d.status === "sent");
  const quotesOpen = docs.filter((d) => d.kind === "quote" && (d.status === "sent" || d.status === "accepted"));
  const sum = (ds: Doc[]) => ds.reduce((a, d) => a + Number(d.total), 0);
  const kpis = [
    { label: "Por cobrar", value: money(sum(unpaid)), sub: `${unpaid.length} factura(s)`, href: "?tipo=invoice" },
    { label: "Vencidas", value: money(sum(overdue)), sub: `${overdue.length} factura(s)`, href: "?tipo=invoice" },
    { label: "Relojes en memo", value: String(memosOut.length), sub: money(sum(memosOut)), href: "?tipo=memo" },
    { label: "Cotizaciones abiertas", value: String(quotesOpen.length), sub: money(sum(quotesOpen)), href: "?tipo=quote" },
  ];

  return (
    <>
      <PageTitle
        eyebrow="CRM"
        title="Documentos"
        action={
          <div className="flex flex-wrap gap-2">
            <Link href="/admin/documentos/ajustes" className={ghostButtonClass}>Ajustes</Link>
            <Link href="/admin/documentos/nuevo?tipo=quote" className={ghostButtonClass}>+ Cotización</Link>
            <Link href="/admin/documentos/nuevo?tipo=memo" className={ghostButtonClass}>+ Memo</Link>
            <Link href="/admin/documentos/nuevo?tipo=consignment" className={ghostButtonClass}>+ Consignación</Link>
            <Link href="/admin/documentos/nuevo?tipo=purchase" className={ghostButtonClass}>+ Compra</Link>
            <Link href="/admin/documentos/nuevo?tipo=invoice" className={buttonClass}>+ Factura</Link>
          </div>
        }
      />
      {error && <p className="mb-6 border border-amber-300/40 bg-amber-300/5 p-4 text-sm">Falta ejecutar la migración <code>2026-10-14-documents.sql</code> en Supabase.</p>}

      <div className="grid grid-cols-2 gap-px border border-line bg-line lg:grid-cols-4">
        {kpis.map((k) => (
          <Link key={k.label} href={`/admin/documentos${k.href}`} className="bg-forest px-5 py-5 hover:bg-moss">
            <p className="break-words font-display text-2xl font-light sm:text-3xl">{k.value}</p>
            <p className="mt-1 text-[0.6rem] tracking-[0.16em] uppercase text-stone">{k.label}</p>
            <p className="mt-1 text-xs text-stone/80">{k.sub}</p>
          </Link>
        ))}
      </div>

      <div className="mt-6 flex gap-1 overflow-x-auto">
        {(["all", "quote", "memo", "invoice", "consignment", "purchase"] as const).map((k) => (
          <Link
            key={k}
            href={k === "all" ? "/admin/documentos" : `/admin/documentos?tipo=${k}`}
            className={`whitespace-nowrap border-b-2 px-3 py-2 text-[0.64rem] tracking-[0.16em] uppercase ${tab === k ? "border-brass text-ivory" : "border-transparent text-stone hover:text-ivory"}`}
          >
            {k === "all" ? "Todos" : KIND_PLURAL[k]} <span className="text-stone/70">{k === "all" ? docs.length : docs.filter((d) => d.kind === k).length}</span>
          </Link>
        ))}
      </div>

      {list.length > 0 && (
        <ul className="mt-4 divide-y divide-line/60 border border-line md:hidden">
          {list.map((d) => {
            const late = d.status === "sent" && d.kind !== "quote" && d.due_date && d.due_date < today;
            return (
              <li key={d.id}>
                <Link href={`/admin/documentos/${d.id}`} className="block px-4 py-3 hover:bg-forest/60">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm">{d.number}</span>
                    <span className="tabular-nums">{usd(d.total)}</span>
                  </div>
                  <p className="mt-0.5 truncate text-sm text-stone">{d.client_name ?? "—"} · {d.items.map((l) => l.title).join(", ")}</p>
                  <p className={`mt-1 text-[0.62rem] tracking-[0.14em] uppercase ${late ? "text-red-200" : STATUS_STYLE[d.status]}`}>
                    {late ? (d.kind === "memo" ? "Memo vencido" : d.kind === "consignment" ? "Plazo cumplido" : "Vencida") : STATUS_LABEL[d.kind][d.status]} · {fmtDate(`${d.issue_date}T12:00:00`)}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {list.length ? (
        <div className="mt-4 hidden overflow-x-auto border border-line md:block">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-forest text-left text-[0.62rem] tracking-[0.2em] uppercase text-stone">
              <tr>
                <th className="px-4 py-3 font-normal">Número</th>
                <th className="px-4 py-3 font-normal">Cliente</th>
                <th className="px-4 py-3 font-normal">Relojes</th>
                <th className="px-4 py-3 font-normal">Fecha</th>
                <th className="px-4 py-3 text-right font-normal">Total</th>
                <th className="px-4 py-3 font-normal">Estado</th>
              </tr>
            </thead>
            <tbody>
              {list.map((d) => {
                const late = d.status === "sent" && d.kind !== "quote" && d.due_date && d.due_date < today;
                return (
                  <tr key={d.id} className="border-t border-line/60 hover:bg-forest/60">
                    <td className="px-4 py-3"><Link href={`/admin/documentos/${d.id}`} className="hover:text-brass">{d.number}</Link></td>
                    <td className="px-4 py-3">{d.client_name ?? "—"}</td>
                    <td className="max-w-[260px] truncate px-4 py-3 text-stone">{d.items.map((l) => l.title).join(", ")}</td>
                    <td className="px-4 py-3 text-stone">{fmtDate(`${d.issue_date}T12:00:00`)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{usd(d.total)}</td>
                    <td className={`px-4 py-3 text-[0.66rem] tracking-[0.14em] uppercase ${late ? "text-red-200" : STATUS_STYLE[d.status]}`}>
                      {late ? (d.kind === "memo" ? "Memo vencido" : d.kind === "consignment" ? "Plazo cumplido" : "Vencida") : STATUS_LABEL[d.kind][d.status]}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        !error && <p className="mt-6 text-sm text-stone">Aún no hay documentos. Crea una cotización, un memo o una factura con los botones de arriba, o desde la ficha de un reloj o de un cliente.</p>
      )}
    </>
  );
}
