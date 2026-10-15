import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { requireUser } from "@/lib/admin-auth";
import { can } from "@/lib/crm-perms";
import { adminDb } from "@/lib/supabase";
import { companyOf, requestsOf, statsFor, waLink } from "@/lib/dealers";
import { KIND_LABEL, STATUS_LABEL, type DocKind } from "@/lib/doc-labels";
import { ACQUISITION, ITEM_STATUS, type Acquisition, type ItemStatus } from "@/lib/stock-labels";
import { Card, fmtDate, PageTitle } from "@/components/admin/ui";
import { DealerAsk } from "@/components/admin/DealerAsk";
import { DealerRequestRow } from "@/components/admin/DealerRequestRow";

export const metadata = { title: "Dealer" };

const money = (n: number | string) => `$${Math.round(Number(n)).toLocaleString("en-US")}`;

// Ficha de un dealer: contacto, resumen, todo lo que se le ha pedido (con sus respuestas), los
// documentos y relojes que hemos movido con él, y su historial.
export default async function DealerPage({ params }: PageProps<"/admin/dealers/[id]">) {
  await connection();
  const user = await requireUser("leads");
  const { id } = await params;
  const db = adminDb();
  const { data: d } = await db.from("customers").select("id, name, phone, wa_id, email, notes, tags, created_at").eq("id", id).maybeSingle();
  if (!d) notFound();
  const [requests, { data: docs }, { data: items }, { data: events }] = await Promise.all([
    requestsOf(id),
    db.from("documents").select("id, kind, number, status, total, created_at").eq("customer_id", id).order("created_at", { ascending: false }).limit(30),
    db.from("inventory_items").select("id, sku, brand, model, reference, status, acquisition, cost, sale_price, supplier_customer_id, purchase_date, sale_date").or(`supplier_customer_id.eq.${id},buyer_customer_id.eq.${id}`).order("created_at", { ascending: false }).limit(30),
    db.from("customer_events").select("id, type, body, created_at").eq("customer_id", id).order("created_at", { ascending: false }).limit(20),
  ]);
  const s = statsFor(requests);
  const company = companyOf(d.notes);
  const isDealer = ((d.tags ?? []) as string[]).some((t) => t.toLowerCase() === "dealer");
  const wa = waLink(d, "");
  const showCosts = can(user, "costos");
  const tile = "border border-line px-4 py-3";

  return (
    <>
      <Link href="/admin/dealers?ver=dealers" className="text-[0.66rem] tracking-[0.2em] uppercase text-stone hover:text-ivory">← Mis dealers</Link>
      <PageTitle
        eyebrow={company ? `Dealer · ${company}` : "Dealer"}
        title={d.name ?? "Sin nombre"}
        action={
          <div className="flex flex-wrap gap-2">
            {wa && <a href={wa.replace(/\?text=$/, "")} target="_blank" rel="noreferrer" className="border border-emerald-300/40 px-4 py-2.5 text-[0.66rem] tracking-[0.2em] uppercase text-emerald-200 hover:bg-emerald-300/10">📲 WhatsApp</a>}
            <Link href={`/admin/leads/${d.id}`} className="border border-line px-4 py-2.5 text-[0.66rem] tracking-[0.2em] uppercase text-stone hover:text-ivory">Ficha completa</Link>
          </div>
        }
      />
      {!isDealer && <p className="mb-4 text-sm text-amber-200">Este cliente ya no tiene la etiqueta «Dealer»: no sale en la lista ni recibe pedidos.</p>}
      <p className="mb-6 text-sm text-stone">{[d.phone, d.email].filter(Boolean).join(" · ") || "Sin teléfono ni correo"} · en el CRM desde {fmtDate(d.created_at)}</p>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className={tile}><p className="text-[0.6rem] tracking-[0.2em] uppercase text-stone">Pedidos</p><p className="mt-1 text-xl">{s.asked}</p></div>
        <div className={tile}><p className="text-[0.6rem] tracking-[0.2em] uppercase text-stone">Respondió</p><p className="mt-1 text-xl">{s.asked ? `${Math.round((s.answered / s.asked) * 100)}%` : "—"}</p></div>
        <div className={tile}><p className="text-[0.6rem] tracking-[0.2em] uppercase text-stone">La tenía</p><p className="mt-1 text-xl">{s.has}</p></div>
        <div className={tile}><p className="text-[0.6rem] tracking-[0.2em] uppercase text-stone">Mejor oferta</p><p className="mt-1 text-xl">{s.best ? money(s.best.price!) : "—"}</p>{s.best && <p className="truncate text-xs text-stone">{s.best.query}</p>}</div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="grid content-start gap-6">
          <Card title={`Lo que se le ha pedido · ${requests.length}`}>
            {requests.length ? (
              <ul className="divide-y divide-line/60">
                {requests.map((r) => (
                  <DealerRequestRow key={r.id} r={r} dealer={d} title={<>{r.query}<span className="text-xs text-stone"> · {fmtDate(r.asked_at)}{r.budget ? ` · hasta ${money(r.budget)}` : ""}</span>{r.document_id && <Link href={`/admin/documentos/${r.document_id}`} className="ml-1 text-xs text-brass hover:text-ivory">encargo →</Link>}</>} />
                ))}
              </ul>
            ) : (
              <p className="text-sm text-stone">Todavía no se le ha pedido nada.</p>
            )}
          </Card>

          <Card title="Relojes con este dealer">
            {items?.length ? (
              <ul className="divide-y divide-line/60 text-sm">
                {items.map((i) => (
                  <li key={i.id} className="flex flex-wrap justify-between gap-2 py-2">
                    <Link href={`/admin/inventario/${i.id}`} className="hover:text-brass">{i.sku} · {[i.brand, i.model, i.reference].filter(Boolean).join(" ")}</Link>
                    <span className="text-xs text-stone">
                      {i.supplier_customer_id === d.id ? `nos lo dio (${ACQUISITION[i.acquisition as Acquisition] ?? i.acquisition}${showCosts && i.cost ? ` · ${money(i.cost)}` : ""})` : `nos lo compró${i.sale_price ? ` · ${money(i.sale_price)}` : ""}`} · {ITEM_STATUS[i.status as ItemStatus] ?? i.status}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-stone">Aún no hay relojes comprados, en memo o vendidos a este dealer.</p>
            )}
          </Card>

          <Card title="Documentos">
            {docs?.length ? (
              <ul className="divide-y divide-line/60 text-sm">
                {docs.map((x) => (
                  <li key={x.id} className="flex flex-wrap justify-between gap-2 py-2">
                    <Link href={`/admin/documentos/${x.id}`} className="hover:text-brass">{KIND_LABEL[x.kind as DocKind]} {x.number}</Link>
                    <span className="text-xs text-stone">{STATUS_LABEL[x.kind as DocKind]?.[x.status as never] ?? x.status}{x.total ? ` · ${money(x.total)}` : ""} · {fmtDate(x.created_at)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-stone">Sin documentos (memos, compras, facturas…) con este dealer.</p>
            )}
          </Card>
        </div>

        <div className="grid content-start gap-6">
          <Card title="🔎 Pedirle una pieza">
            <DealerAsk dealers={[{ id: d.id, name: d.name, phone: d.phone, reachable: Boolean(d.wa_id || d.phone) }]} />
          </Card>
          {d.notes && (
            <Card title="Notas">
              <p className="whitespace-pre-line text-sm text-stone">{d.notes}</p>
            </Card>
          )}
          <Card title="Historial">
            {events?.length ? (
              <ul className="space-y-2 text-sm">
                {events.map((e) => (
                  <li key={e.id}>
                    <p>{e.body}</p>
                    <p className="text-xs text-stone">{fmtDate(e.created_at)}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-stone">Sin movimientos.</p>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
