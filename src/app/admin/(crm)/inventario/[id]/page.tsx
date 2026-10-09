import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { adminDb } from "@/lib/supabase";
import { requireUser } from "@/lib/admin-auth";
import { can } from "@/lib/crm-perms";
import { daysInStock, margin, totalCost, type Item } from "@/lib/stock";
import { ACQUISITION, ITEM_STATUS, isOwnerStock } from "@/lib/stock-labels";
import { Card, fieldClass, fmtDate, fmtDateTime, ghostButtonClass, money, PageTitle, requestTime } from "@/components/admin/ui";
import { ItemForm, ReturnForm, SaleForm } from "@/components/admin/ItemForms";
import { STATUS_LABEL, type DocKind, type DocStatus } from "@/lib/doc-labels";
import { deleteItem, markCountedAction, markOwnerPaid, reopenItem, returnFromServiceAction, sendToServiceAction, setLocation, setReserved } from "../../../inventory-actions";
import { itemServices, providers } from "@/lib/services";
import { LOCATIONS, type Location } from "@/lib/locations";
import { team } from "@/lib/team";
import { awayItems, openCount } from "@/lib/stock-count";

export const metadata = { title: "Reloj del inventario" };

const EVENT_ICON: Record<string, string> = { service: "🔧", entry: "⇢", price: "$", cost: "$", status: "•", sale: "✓", return: "↩", owed: "⏳", owner_paid: "💵", import: "⇣" };

export default async function ItemPage({ params }: PageProps<"/admin/inventario/[id]">) {
  await connection();
  const user = await requireUser("inventario");
  const showCosts = can(user, "costos");
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
  const [services, knownProviders, count, away] = await Promise.all([itemServices(id), providers(), openCount(), awayItems()]);
  const counting = count && count.expected.includes(id) ? count : null;
  const openService = services.find((s) => !s.returned_at);
  // Cotizaciones, memos y facturas en las que aparece (vacío si falta la migración)
  const { data: docs } = await db.from("documents").select("id, kind, number, status, client_name, total").contains("items", [{ item_id: id }]).order("created_at", { ascending: false });
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
            <a href={`/api/certificate/${item.id}`} target="_blank" rel="noreferrer" className={ghostButtonClass}>Certificado</a>
            <a href={`/admin/etiquetas?ids=${item.id}`} target="_blank" rel="noreferrer" className={ghostButtonClass}>Etiqueta QR</a>
            <Link href={`/admin/tareas?reloj=${item.id}`} className={ghostButtonClass}>+ Tarea</Link>
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
          ...(showCosts ? [[owner ? "A pagar al dueño" : "Costo", money(item.cost)], ["Costo total", item.cost == null ? "—" : money(totalCost(item))]] : []),
          [item.status === "sold" ? "Venta" : "Precio previsto", money(item.status === "sold" ? item.sale_price : item.asking_price)],
          [item.status === "sold" && showCosts ? "Margen" : "Días en stock", item.status === "sold" && showCosts ? (m ? `${money(m.amount)} · ${m.onSale != null ? Math.round(m.onSale * 100) : "—"}%` : "—") : days == null ? "—" : `${days} días`],
        ].map(([l, v]) => (
          <div key={l} className="bg-forest px-5 py-4">
            <p className="font-display text-2xl font-light">{v}</p>
            <p className="mt-1 text-[0.6rem] tracking-[0.16em] uppercase text-stone">{l}</p>
          </div>
        ))}
      </div>

      {counting && (
        <form action={markCountedAction.bind(null, counting.id, item.id, !counting.found.includes(item.id))} className="mt-6 flex flex-wrap items-center justify-between gap-3 border border-brass/50 bg-brass/5 p-4 text-sm">
          <span>📋 Conteo de inventario en curso</span>
          <button className={counting.found.includes(item.id) ? "text-[0.66rem] tracking-[0.18em] uppercase text-emerald-200" : "bg-ivory px-5 py-2.5 text-[0.68rem] tracking-[0.22em] uppercase text-ink hover:bg-brass"}>
            {counting.found.includes(item.id) ? "✓ Contado (deshacer)" : "✓ Contado"}
          </button>
        </form>
      )}

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          {available && (
            <Card title="Ubicación">
              {away.get(item.id) ? (
                <p className="text-sm">📍 {away.get(item.id)}</p>
              ) : (
                <form action={setLocation.bind(null, item.id)} className="grid gap-3 sm:grid-cols-[200px_1fr_auto] sm:items-end">
                  <select name="location" defaultValue={item.location ?? ""} className={fieldClass}>
                    <option value="">— Sin indicar —</option>
                    {Object.entries(LOCATIONS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                  <input name="location_note" defaultValue={item.location_note ?? ""} placeholder="Detalle (cajón 2, con Juan…)" className={fieldClass} />
                  <button className={ghostButtonClass}>Guardar</button>
                </form>
              )}
              {item.last_counted_at && <p className="mt-2 text-xs text-stone">Último conteo: {fmtDateTime(item.last_counted_at)}</p>}
              {!away.get(item.id) && item.location && <p className="mt-2 text-xs text-stone">📍 {LOCATIONS[item.location as Location]}{item.location_note ? ` · ${item.location_note}` : ""}</p>}
            </Card>
          )}

          {(available || services.length > 0) && (
            <Card title={openService ? "🔧 En el relojero" : "Relojero"}>
              {openService ? (
                <>
                  <p className="text-sm">
                    {openService.provider}{openService.work ? ` · ${openService.work}` : ""} · desde {fmtDate(`${openService.sent_at}T12:00:00`)}
                    {openService.expected_at && <span className="text-stone"> · vuelve ~{fmtDate(`${openService.expected_at}T12:00:00`)}</span>}
                  </p>
                  <form action={returnFromServiceAction.bind(null, openService.id)} className="mt-4 grid gap-3 sm:grid-cols-[160px_1fr_auto] sm:items-end">
                    <label><span className="mb-1.5 block text-[0.62rem] tracking-[0.22em] uppercase text-stone">Costo (USD)</span><input name="cost" inputMode="decimal" className={fieldClass} /></label>
                    <label><span className="mb-1.5 block text-[0.62rem] tracking-[0.22em] uppercase text-stone">Notas</span><input name="notes" placeholder="Qué se hizo" className={fieldClass} /></label>
                    <button className={ghostButtonClass}>Ya volvió</button>
                  </form>
                  <p className="mt-2 text-xs text-stone">El costo se suma a los gastos del reloj (y a su margen).</p>
                </>
              ) : available ? (
                <form action={sendToServiceAction.bind(null, item.id)} className="grid gap-3 sm:grid-cols-3 sm:items-end">
                  <label>
                    <span className="mb-1.5 block text-[0.62rem] tracking-[0.22em] uppercase text-stone">Relojero *</span>
                    <input name="provider" list="providers" required className={fieldClass} />
                    <datalist id="providers">{knownProviders.map((p) => <option key={p} value={p} />)}</datalist>
                  </label>
                  <label><span className="mb-1.5 block text-[0.62rem] tracking-[0.22em] uppercase text-stone">Trabajo</span><input name="work" placeholder="Servicio, pulido…" className={fieldClass} /></label>
                  <label><span className="mb-1.5 block text-[0.62rem] tracking-[0.22em] uppercase text-stone">Vuelve aprox.</span><input name="expected_at" type="date" className={fieldClass} /></label>
                  <button className={`${ghostButtonClass} sm:col-span-3 sm:justify-self-start`}>🔧 Enviar al relojero</button>
                </form>
              ) : null}
              {services.filter((s) => s.returned_at).length > 0 && (
                <ul className="mt-4 space-y-1 border-t border-line pt-3 text-xs text-stone">
                  {services.filter((s) => s.returned_at).map((s) => (
                    <li key={s.id}>{fmtDate(`${s.sent_at}T12:00:00`)} → {fmtDate(`${s.returned_at}T12:00:00`)} · {s.provider}{s.work ? ` · ${s.work}` : ""}{s.cost ? ` · ${money(s.cost)}` : ""}</li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          <Card title="Cotizaciones, memos y facturas">
            {docs?.length ? (
              <ul className="mb-4 space-y-2 text-sm">
                {docs.map((d) => (
                  <li key={d.id as string} className="flex justify-between gap-3 border-b border-line/60 pb-2">
                    <Link href={`/admin/documentos/${d.id}`} className="hover:text-brass">{d.number as string} · {(d.client_name as string) ?? "—"}</Link>
                    <span className="text-stone">{STATUS_LABEL[d.kind as DocKind][d.status as DocStatus]} · {money(d.total as number)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {available && (
              <div className="flex flex-wrap gap-2">
                <Link href={`/admin/documentos/nuevo?tipo=quote&reloj=${item.id}`} className={ghostButtonClass}>+ Cotización</Link>
                <Link href={`/admin/documentos/nuevo?tipo=memo&reloj=${item.id}`} className={ghostButtonClass}>+ Memo</Link>
                <Link href={`/admin/documentos/nuevo?tipo=invoice&reloj=${item.id}`} className={ghostButtonClass}>+ Factura</Link>
                {(item.acquisition === "purchase" || item.acquisition === "trade") && (
                  <Link href={`/admin/documentos/nuevo?tipo=purchase&reloj=${item.id}${item.supplier_customer_id ? `&cliente=${item.supplier_customer_id}` : ""}`} className={ghostButtonClass}>+ Contrato de compra</Link>
                )}
                {item.acquisition === "consignment" && (
                  <Link href={`/admin/documentos/nuevo?tipo=consignment&reloj=${item.id}${item.supplier_customer_id ? `&cliente=${item.supplier_customer_id}` : ""}`} className={ghostButtonClass}>+ Contrato de consignación</Link>
                )}
              </div>
            )}
          </Card>

          {available && <Card title="Registrar venta"><SaleForm item={item} customers={customerOptions} today={today} sellers={(await team()).map((m) => ({ email: m.email, label: m.name ?? m.email }))} me={user.email} /></Card>}

          {item.status === "sold" && (
            <Card title="Venta">
              <p className="text-sm">
                {fmtDate(item.sale_date!)} · {money(item.sale_price)} · {item.payment_method ?? "—"} ·{" "}
                {item.buyer_customer_id ? <Link href={`/admin/leads/${item.buyer_customer_id}`} className="text-brass hover:text-ivory">{item.buyer_name ?? "Cliente"}</Link> : item.buyer_name ?? "—"}
              </p>
              {owner && showCosts && (
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
            <ItemForm item={item} watches={watchOptions} showCosts={showCosts} />
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
