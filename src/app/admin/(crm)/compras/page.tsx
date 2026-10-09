import Link from "next/link";
import { connection } from "next/server";
import { adminDb } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";
import { ago, fieldClass, PageTitle, requestTime } from "@/components/admin/ui";
import { updateSellRequest } from "../../actions";

export const metadata = { title: "Compras y consignas" };

// Relojes que los clientes nos ofrecen, por etapa: de la solicitud al pago
const COLUMNS = [
  { key: "new", label: "Nuevas" },
  { key: "offered", label: "Ofertadas" },
  { key: "accepted", label: "Aceptadas" },
  { key: "received", label: "Reloj recibido" },
  { key: "paid", label: "Pagadas" },
  { key: "rejected", label: "Rechazadas" },
] as const;
const KIND = { sell: "Venta", trade: "Intercambio", consign: "Consignación" } as Record<string, string>;

export default async function ComprasPage() {
  await connection();
  // La plantilla y la página se generan en paralelo: cada página comprueba la sesión antes de leer datos
  await requireAdmin();
  const { data } = await adminDb().from("sell_requests").select("*").order("created_at", { ascending: false }).limit(300);
  const rows = data ?? [];
  // Relojes que ya entraron al inventario desde una solicitud (si falta la migración, queda vacío)
  const { data: stocked } = rows.length
    ? await adminDb().from("inventory_items").select("id, sku, sell_request_id").in("sell_request_id", rows.map((r) => r.id as string))
    : { data: [] };
  const stockOf = (id: string) => (stocked ?? []).find((s) => s.sell_request_id === id);
  const now = requestTime();

  return (
    <>
      <PageTitle eyebrow="CRM" title="Compras y consignaciones" />
      <div className="flex gap-4 overflow-x-auto pb-4">
        {COLUMNS.map((col) => {
          const items = rows.filter((r) => (r.status ?? "new") === col.key);
          return (
            <section key={col.key} className="w-[290px] shrink-0">
              <h2 className="mb-3 flex justify-between text-[0.66rem] tracking-[0.22em] uppercase text-stone">
                {col.label} <span>{items.length}</span>
              </h2>
              <div className="space-y-3">
                {items.map((r) => (
                  <article key={r.id as string} className="border border-line bg-forest/70 p-4 text-sm">
                    <p className="text-[0.62rem] tracking-[0.2em] uppercase text-brass">{KIND[r.kind as string] ?? r.kind}</p>
                    <p className="mt-1 font-display text-lg leading-tight">{[r.brand, r.model, r.reference].filter(Boolean).join(" ")}</p>
                    <p className="mt-1 text-xs text-stone">
                      {r.customer_id ? (
                        <Link href={`/admin/leads/${r.customer_id}`} className="hover:text-ivory">{r.name as string}</Link>
                      ) : (
                        (r.name as string)
                      )}{" "}
                      · {ago(r.created_at as string, now)}
                    </p>
                    {stockOf(r.id as string) && (
                      <Link href={`/admin/inventario/${stockOf(r.id as string)!.id}`} className="mt-2 inline-block text-xs text-emerald-200 hover:text-ivory">
                        ✓ En inventario · {stockOf(r.id as string)!.sku} →
                      </Link>
                    )}
                    {(r.status ?? "new") === "accepted" && !stockOf(r.id as string) && (
                      <p className="mt-2 text-xs text-stone">Al marcarlo «Reloj recibido» entrará solo al inventario.</p>
                    )}
                    {Boolean(r.message) && <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-xs text-stone">{r.message as string}</p>}
                    {(r.image_paths as string[])?.length > 0 && (
                      <div className="mt-3 flex gap-1.5 overflow-x-auto">
                        {(r.image_paths as string[]).map((u) => (
                          <a key={u} href={u} target="_blank" rel="noreferrer">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={u} alt="" className="h-14 w-14 object-cover" />
                          </a>
                        ))}
                      </div>
                    )}
                    <form action={updateSellRequest.bind(null, r.id as string)} className="mt-3 grid gap-2">
                      <div className="grid grid-cols-2 gap-2">
                        <select name="status" defaultValue={(r.status as string) ?? "new"} className={`${fieldClass} px-2 py-2 text-xs`}>
                          {COLUMNS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                        </select>
                        <input name="offer" defaultValue={(r.offer_amount as number | null) ?? ""} placeholder="Oferta USD" inputMode="numeric" className={`${fieldClass} px-2 py-2 text-xs`} />
                      </div>
                      <input name="notes" defaultValue={(r.notes as string | null) ?? ""} placeholder="Notas internas" className={`${fieldClass} px-2 py-2 text-xs`} />
                      <button className="border border-line py-1.5 text-[0.62rem] tracking-[0.2em] uppercase text-stone hover:border-ivory/40 hover:text-ivory">Guardar</button>
                    </form>
                  </article>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
