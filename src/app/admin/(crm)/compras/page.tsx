import { tr } from "@/lib/admin-i18n";
import Link from "next/link";
import { connection } from "next/server";
import { adminDb } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";
import { ago, fieldClass, PageTitle, requestTime } from "@/components/admin/ui";
import { offerMarketAction, updateSellRequest } from "../../actions";
import { askingOf, offerSuggestion } from "@/lib/offers";
import { PendingButton } from "@/components/admin/PendingButton";
import { OfferReply } from "@/components/admin/OfferReply";
import { OfferNew } from "@/components/admin/OfferNew";

export const metadata = { title: "Ofertas de clientes" };

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

export default async function ComprasPage({ searchParams }: PageProps<"/admin/compras">) {
  await connection();
  // La plantilla y la página se generan en paralelo: cada página comprueba la sesión antes de leer datos
  await requireAdmin("compras");
  const sp = await searchParams;
  const { data } = await adminDb().from("sell_requests").select("*").order("created_at", { ascending: false }).limit(300);
  const rows = data ?? [];
  // Relojes que ya entraron al inventario desde una solicitud (si falta la migración, queda vacío)
  const { data: stocked } = rows.length
    ? await adminDb().from("inventory_items").select("id, sku, sell_request_id").in("sell_request_id", rows.map((r) => r.id as string))
    : { data: [] };
  // Idioma de cada cliente (para el mensaje de la oferta)
  const ids = [...new Set(rows.map((r) => r.customer_id as string).filter(Boolean))];
  const { data: langs } = ids.length ? await adminDb().from("customers").select("id, lang, phone, wa_id").in("id", ids) : { data: [] };
  const langOf = new Map((langs ?? []).map((c) => [c.id as string, c.lang === "en" ? ("en" as const) : ("es" as const)]));
  const phoneOf = new Set((langs ?? []).filter((c) => c.phone || c.wa_id).map((c) => c.id as string));
  const stockOf = (id: string) => (stocked ?? []).find((s) => s.sell_request_id === id);
  const now = requestTime();

  return (
    <>
      <PageTitle eyebrow="Redes" title="Ofertas de clientes" />
      <p className="mb-5 text-sm text-stone">{tr("Relojes que te ofrecen para comprar, cambiar o consignar. Al recibirlo, entra solo al inventario.")}</p>
      <div className="mb-6"><OfferNew startOpen={sp.nueva === "1"} /></div>
      <div className="flex gap-4 overflow-x-auto pb-4">
        {COLUMNS.map((col) => {
          const items = rows.filter((r) => (r.status ?? "new") === col.key);
          return (
            <section key={col.key} className="w-[290px] shrink-0">
              <h2 className="mb-3 flex justify-between text-[0.66rem] tracking-[0.22em] uppercase text-stone">
                {tr(col.label)} <span>{items.length}</span>
              </h2>
              <div className="space-y-3">
                {items.map((r) => (
                  <article key={r.id as string} className="border border-line bg-forest/70 p-4 text-sm">
                    <p className="text-[0.62rem] tracking-[0.2em] uppercase text-brass">{tr(KIND[r.kind as string] ?? r.kind)}</p>
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
                        {tr("✓ En inventario ·")} {stockOf(r.id as string)!.sku} →
                      </Link>
                    )}
                    {stockOf(r.id as string) && r.kind === "consign" && (
                      <Link
                        href={`/admin/documentos/nuevo?tipo=consignment&reloj=${stockOf(r.id as string)!.id}${r.customer_id ? `&cliente=${r.customer_id}` : ""}`}
                        className="mt-1 block text-xs text-brass hover:text-ivory"
                      >
                        {tr("+ Contrato de consignación →")}
                      </Link>
                    )}
                    {(r.status ?? "new") === "accepted" && !stockOf(r.id as string) && (
                      <p className="mt-2 text-xs text-stone">{tr("Al marcarlo «Reloj recibido» entrará solo al inventario.")}</p>
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
                    <OfferMarket r={r} lang={langOf.get(r.customer_id as string) ?? "es"} hasPhone={Boolean(r.phone) || phoneOf.has(r.customer_id as string)} />
                    <form action={updateSellRequest.bind(null, r.id as string)} className="mt-3 grid gap-2">
                      <div className="grid grid-cols-2 gap-2">
                        <select name="status" defaultValue={(r.status as string) ?? "new"} className={`${fieldClass} px-2 py-2 text-xs`}>
                          {COLUMNS.map((c) => <option key={c.key} value={c.key}>{tr(c.label)}</option>)}
                        </select>
                        <input name="offer" defaultValue={(r.offer_amount as number | null) ?? ""} placeholder={tr("Oferta USD")} inputMode="numeric" className={`${fieldClass} px-2 py-2 text-xs`} />
                      </div>
                      <input name="notes" defaultValue={(r.notes as string | null) ?? ""} placeholder={tr("Notas internas")} className={`${fieldClass} px-2 py-2 text-xs`} />
                      <button className="border border-line py-1.5 text-[0.62rem] tracking-[0.2em] uppercase text-stone hover:border-ivory/40 hover:text-ivory">{tr("Guardar")}</button>
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

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

// Precio de mercado de la oferta y cuánto ofrecer (o, en consignación, a cuánto venderlo y cuánto le queda al dueño)
function OfferMarket({ r, lang, hasPhone }: { r: Record<string, unknown>; lang: "es" | "en"; hasPhone: boolean }) {
  const open = !["paid", "rejected"].includes((r.status as string) ?? "new");
  const typical = r.market_typical != null ? Number(r.market_typical) : null;
  const low = r.market_low != null ? Number(r.market_low) : null;
  const high = r.market_high != null ? Number(r.market_high) : null;
  const asking = askingOf(r.message as string | null);
  const s = offerSuggestion(r.kind as string, typical);
  const checked = Boolean(r.market_checked_at);
  return (
    <div className="mt-3 border-t border-line/60 pt-3 text-xs">
      {typical || low || high ? (
        <>
          <p className="text-stone">
            {tr("Mercado:")} <span className="text-ivory">{low ? usd(low) : "?"} – {high ? usd(high) : "?"}</span>
            {typical ? <> {tr("· típico")} <span className="text-ivory">{usd(typical)}</span></> : null}
            {r.market_listings ? ` · ${r.market_listings} anuncios` : ""}
          </p>
          {s?.kind === "buy" && (
            <p className="mt-1 text-emerald-200">{tr("Ofrecer:")} {s.offers.map((o) => `${usd(o.amount)} (${Math.round(o.margin * 100)}%)`).join(" · ")}</p>
          )}
          {s?.kind === "consign" && (
            <p className="mt-1 text-emerald-200">{tr("Venderlo a ≈")} {usd(s.sellAt)} {tr("· al dueño ≈")} {usd(s.owner)} {tr("(15% para ti)")}</p>
          )}
          {asking && typical ? (
            <p className={`mt-1 ${asking > typical * 0.9 ? "text-amber-200" : "text-stone"}`}>
              {tr("Pide")} {usd(asking)}: {r.kind === "consign" ? (asking > typical ? tr("por encima del mercado") : tr("por debajo del mercado")) : tr("te dejaría {n}% de margen", { n: Math.round(((typical - asking) / typical) * 100) })}
            </p>
          ) : null}
          {Boolean(r.market_note) && <p className="mt-1 text-stone">{r.market_note as string}</p>}
          {((r.market_sources as string[] | null) ?? []).length > 0 && (
            <p className="mt-1 flex flex-wrap gap-2">
              {(r.market_sources as string[]).map((u, i) => <a key={u} href={u} target="_blank" rel="noreferrer" className="text-brass hover:text-ivory">{tr("Fuente")} {i + 1}</a>)}
            </p>
          )}
        </>
      ) : checked ? (
        <p className="text-stone">{tr("No se encontraron anuncios comparables.")}</p>
      ) : null}
      {["new", "offered"].includes((r.status as string) ?? "new") && (
        <OfferReply
          id={r.id as string}
          hasPhone={hasPhone}
          defaultLang={lang}
          amounts={s?.kind === "buy" ? s.offers.map((o) => ({ amount: o.amount, label: `${Math.round(o.margin * 100)}%` })) : s?.kind === "consign" ? [{ amount: s.owner, label: tr("neto al dueño") }] : []}
        />
      )}
      {open && (
        <form action={offerMarketAction.bind(null, r.id as string)} className="mt-2">
          <PendingButton pending={tr("Buscando precios… (≈1 min)")} className="border border-line px-2.5 py-1 text-[0.6rem] tracking-[0.16em] uppercase text-stone hover:text-ivory">
            {checked ? tr("🔎 Volver a tasar") : tr("🔎 Tasar (precio de mercado)")}
          </PendingButton>
        </form>
      )}
    </div>
  );
}
