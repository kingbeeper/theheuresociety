import Link from "next/link";
import { connection } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { demandBoard } from "@/lib/demand";
import { PageTitle } from "@/components/admin/ui";

export const metadata = { title: "Demanda" };

export default async function DemandPage() {
  await connection();
  await requireAdmin("demanda");
  const rows = await demandBoard();
  const max = Math.max(1, ...rows.map((r) => Math.max(r.people.length, r.stock.length)));

  return (
    <>
      <PageTitle eyebrow="CRM" title="Demanda frente a inventario" />
      <p className="-mt-4 mb-6 max-w-2xl text-sm text-stone">
        Lo que buscan tus clientes (búsquedas «avísenme» y el «qué busca» de los leads abiertos de los últimos 6 meses), agrupado por modelo,
        frente a lo que tienes disponible. Arriba, lo que conviene comprar.
      </p>

      {rows.length ? (
        <ul className="divide-y divide-line/60 border border-line">
          {rows.map((r) => {
            const gap = r.people.length - r.stock.length;
            const signal = gap > 0 ? { text: `Comprar · faltan ${gap}`, cls: "text-emerald-200 border-emerald-300/40" } : r.people.length === 0 ? { text: "Sin demanda", cls: "text-amber-200 border-amber-300/40" } : { text: "Cubierto", cls: "text-stone border-line" };
            return (
              <li key={r.family}>
                <details className="group">
                  <summary className="grid cursor-pointer list-none grid-cols-[1fr_auto] items-center gap-3 px-4 py-3 hover:bg-forest/60 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto]">
                    <span className="min-w-0 truncate">{r.family}</span>
                    <span className="order-3 col-span-2 grid gap-1 text-xs text-stone sm:order-none sm:col-span-1">
                      <span className="flex items-center gap-2">
                        <span className="h-1.5 bg-brass/70" style={{ width: `${(r.people.length / max) * 100}%`, minWidth: r.people.length ? 4 : 0 }} />
                        {r.people.length} cliente{r.people.length === 1 ? "" : "s"}
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="h-1.5 bg-ivory/40" style={{ width: `${(r.stock.length / max) * 100}%`, minWidth: r.stock.length ? 4 : 0 }} />
                        {r.stock.length} en stock
                      </span>
                    </span>
                    <span className={`border px-2 py-1 text-[0.6rem] tracking-[0.14em] uppercase ${signal.cls}`}>{signal.text}</span>
                  </summary>
                  <div className="grid gap-4 px-4 pb-4 text-sm sm:grid-cols-2">
                    <div>
                      <p className="mb-1 text-[0.6rem] tracking-[0.16em] uppercase text-stone">Lo buscan</p>
                      {r.people.length ? r.people.map((p) => (
                        <p key={p.id}><Link href={`/admin/leads/${p.id}`} className="hover:text-brass">{p.name ?? "Sin nombre"}</Link> <span className="text-xs text-stone">· {p.query}</span></p>
                      )) : <p className="text-stone">Nadie por ahora.</p>}
                    </div>
                    <div>
                      <p className="mb-1 text-[0.6rem] tracking-[0.16em] uppercase text-stone">En stock</p>
                      {r.stock.length ? r.stock.map((s) => (
                        <p key={s.id}><Link href={`/admin/inventario/${s.id}`} className="hover:text-brass">{s.sku}</Link> <span className="text-xs text-stone">· {s.title}</span></p>
                      )) : <p className="text-stone">Ninguno.</p>}
                    </div>
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="border border-line bg-forest/60 p-8 text-center text-sm text-stone">Todavía no hay búsquedas de clientes ni relojes en stock para comparar.</p>
      )}
    </>
  );
}
