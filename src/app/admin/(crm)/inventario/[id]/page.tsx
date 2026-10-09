import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { adminDb } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";
import { daysInStock, margin, totalCost, type Item } from "@/lib/stock";
import { ACQUISITION, ITEM_STATUS, isOwnerStock } from "@/lib/stock-labels";
import { Card, fmtDate, fmtDateTime, ghostButtonClass, money, PageTitle, requestTime } from "@/components/admin/ui";
import { ItemForm, ReturnForm, SaleForm } from "@/components/admin/ItemForms";
import { deleteItem, markOwnerPaid, reopenItem, setReserved } from "../../../inventory-actions";

export const metadata = { title: "Reloj del inventario" };

const EVENT_ICON: Record<string, string> = { entry: "⇢", price: "$", cost: "$", status: "•", sale: "✓", return: "↩", owed: "⏳", owner_paid: "💵", import: "⇣" };

export default async function ItemPage({ params }: PageProps<"/admin/inventario/[id]">) {
  await connection();
  await requireAdmin();
  const { id } = await params;
  const db = adminDb();
  const { data } = await db.from("inventory_items").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const item = data as Item;
  const now = requestTime();
  const today = new Date(now).toISOString().slice(0, 10);

  const [events, watches, customers, web] = await Promise.all([
    db.from("inventory_events").select("*").eq("item_id", id).order("created_at", { ascending: false }),
    db.from("watches").select("id, brand, model, reference, status").order("published_at", { ascending: false }),
    db.from("customers").select("id, name, phone, email").order("last_activity_at", { ascending: false }).limit(500),
    item.watch_id ? db.from("watches").select("slug, status").eq("id", item.watch_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const watchOptions = (watches.data ?? []).map((w) => ({ id: w.id as string, label: `${w.brand} ${w.model} · ${w.reference}${w.status === "sold" ? " (vendido)" : ""}` }));
  const customerOptions = (customers.data ?? []).map((c) => ({ id: c.id as string, label: [c.name, c.phone, c.email].filter(Boolean).join(" · ") || "Sin nombre" }));

  const m = margin(item);
  const days = daysInStock(item, now);
  const available = item.status === "in_stock" || item.status === "reserved";
  const owner = isOwnerStock(item.acquisition);

  return (
    <>
      <Link href="/admin/inventario" className="text-[0.66rem] tracking-[0.2em] uppercase text-stone hover:text-ivory">← Inventario</Link>
      <PageTitle
        eyebrow={`${item.sku} · ${ACQUISITION[item.acquisition]}`}
        title={`${item.brand} ${item.model ?? ""}`.trim()}
        action={
          <div className="flex flex-wrap gap-2">
            {web.data?.slug && <a href={`/es/watches/${web.data.slug}`} target="_blank" rel="noreferrer" className={ghostButtonClass}>Ver en la web</a>}
            {available && (
              <form action={setReserved.bind(null, item.id, item.status !== "reserved")}>
                <button className={ghostButtonClass}>{item.status === "reserved" ? "Quitar reserva" : "Reservar"}</button>
              </form>
            )}
            {!available && (
              <form action={reopenItem.bind(null, item.id)}><button className={ghostButtonClass}>Volver a stock</button></form>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-px border border-line bg-line md:grid-cols-5">
        {[
          ["Estado", ITEM_STATUS[item.status]],
          [owner ? "A pagar al dueño" : "Costo", money(item.cost)],
          ["Costo total", item.cost == null ? "—" : money(totalCost(item))],
          [item.status === "sold" ? "Venta" : "Precio previsto", money(item.status === "sold" ? item.sale_price : item.asking_price)],
          [item.status === "sold" ? "Margen" : "Días en stock", item.status === "sold" ? (m ? `${money(m.amount)} · ${m.onSale != null ? Math.round(m.onSale * 100) : "—"}%` : "—") : days == null ? "—" : `${days} días`],
        ].map(([l, v]) => (
          <div key={l} className="bg-forest px-5 py-4">
            <p className="font-display text-2xl font-light">{v}</p>
            <p className="mt-1 text-[0.6rem] tracking-[0.16em] uppercase text-stone">{l}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          {available && <Card title="Registrar venta"><SaleForm item={item} customers={customerOptions} today={today} /></Card>}

          {item.status === "sold" && (
            <Card title="Venta">
              <p className="text-sm">
                {fmtDate(item.sale_date!)} · {money(item.sale_price)} · {item.payment_method ?? "—"} ·{" "}
                {item.buyer_customer_id ? <Link href={`/admin/leads/${item.buyer_customer_id}`} className="text-brass hover:text-ivory">{item.buyer_name ?? "Cliente"}</Link> : item.buyer_name ?? "—"}
              </p>
              {owner && (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4 text-sm">
                  {item.owner_paid_at ? (
                    <p className="text-emerald-200">Pagado al dueño el {fmtDate(item.owner_paid_at)}</p>
                  ) : (
                    <>
                      <p className="text-amber-200">Pendiente de pagar al dueño: {money(item.cost)}</p>
                      <form action={markOwnerPaid.bind(null, item.id)}><button className={ghostButtonClass}>Marcar como pagado</button></form>
                    </>
                  )}
                </div>
              )}
            </Card>
          )}

          {available && (
            <Card title={owner ? `Devolver ${item.acquisition === "consignment" ? "al consignatario" : "al dealer"}` : "Devolución"}>
              {item.acquisition === "memo" && item.memo_due && <p className="mb-3 text-sm text-stone">Memo: devolver antes del {fmtDate(item.memo_due)}.</p>}
              <ReturnForm item={item} today={today} />
            </Card>
          )}

          {item.status === "returned" && (
            <Card title="Devolución">
              <p className="text-sm">{fmtDate(item.return_date!)}{item.return_reason ? ` · ${item.return_reason}` : ""}</p>
            </Card>
          )}

          <Card title="Ficha del reloj">
            <ItemForm item={item} watches={watchOptions} />
          </Card>

          <form action={deleteItem.bind(null, item.id)} className="text-right">
            <button className="text-xs text-stone underline hover:text-red-200">Eliminar del inventario (solo si fue un error)</button>
          </form>
        </div>

        <Card title="Historial">
          <ol className="space-y-3">
            {(events.data ?? []).map((e) => (
              <li key={e.id as string} className="border-l-2 border-brass/50 pl-3">
                <p className="text-[0.66rem] tracking-[0.12em] text-stone">
                  {EVENT_ICON[e.type as string] ?? "•"} {e.created_by as string} · {fmtDateTime(e.created_at as string)}
                </p>
                <p className="mt-0.5 text-sm">{e.body as string}</p>
              </li>
            ))}
            {!events.data?.length && <p className="text-sm text-stone">Sin movimientos.</p>}
          </ol>
        </Card>
      </div>
    </>
  );
}
