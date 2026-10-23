import { tr } from "@/lib/admin-i18n";
import Link from "next/link";
import { connection } from "next/server";
import { requireUser } from "@/lib/admin-auth";
import { adminDb } from "@/lib/supabase";
import { dealerAccounts, memosDueSoon, sum, type DealerAccount } from "@/lib/dealer-account";
import { todayInMiami } from "@/lib/booking";
import { companyOf, dealers, statsFor, waLink, type DealerRequest } from "@/lib/dealers";
import { Card, fmtDate, PageTitle, requestTime } from "@/components/admin/ui";
import { DealerAsk } from "@/components/admin/DealerAsk";
import { dealerDiscount, dealerItems, pricelistMessage, pricelistUrl } from "@/lib/pricelist";
import { dealerDiscountAction, pricelistAction } from "../../actions";
import { DealerAdd } from "@/components/admin/DealerAdd";
import { DealerRequestRow } from "@/components/admin/DealerRequestRow";

export const metadata = { title: "Dealers" };

const money = (n: number | string) => `$${Math.round(Number(n)).toLocaleString("en-US")}`;
const tab = (on: boolean) => `border-b-2 px-1 pb-2 text-[0.68rem] tracking-[0.22em] uppercase ${on ? "border-brass text-ivory" : "border-transparent text-stone hover:text-ivory"}`;

// Red de dealers: pestaña «Pedir una pieza» (pedidos y respuestas) y pestaña «Mis dealers» (directorio
// con el resumen de cada uno; al tocarlo se abre su ficha con todo su historial).
export default async function DealersPage({ searchParams }: PageProps<"/admin/dealers">) {
  await connection();
  await requireUser("leads");
  const sp = await searchParams;
  const view = sp.ver === "dealers" ? "dealers" : "pedir";
  const encargo = typeof sp.encargo === "string" ? sp.encargo : null;
  // Desde la ficha de un cliente: su búsqueda («avísenme») ya escrita y el pedido queda a su nombre
  const forQuery = typeof sp.q === "string" && sp.ver !== "dealers" ? sp.q.slice(0, 200) : "";
  const forClient = typeof sp.cliente === "string" ? sp.cliente : null;
  const { data: client } = forClient ? await adminDb().from("customers").select("id, name").eq("id", forClient).maybeSingle() : { data: null };
  const q = typeof sp.q === "string" ? sp.q.trim().toLowerCase() : "";
  const db = adminDb();
  const [list, { data: reqRows }, { data: doc }] = await Promise.all([
    dealers(),
    db.from("dealer_requests").select("*").order("asked_at", { ascending: false }).limit(500),
    encargo ? db.from("documents").select("id, number, items, total, client_name").eq("id", encargo).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const requests = (reqRows ?? []) as DealerRequest[];
  const byId = new Map(list.map((d) => [d.id, d]));
  const pending = requests.filter((r) => r.status === "asked").length;
  const accounts = await dealerAccounts(list.map((d) => d.id), todayInMiami(new Date(requestTime())));
  const lateMemos = [...accounts.values()].reduce((n, a) => n + [...a.memoFromHim, ...a.memoToHim].filter((m) => m.days != null && m.days > 0).length, 0);

  return (
    <>
      <PageTitle eyebrow="Contactos" title="Dealers" />
      <nav className="mb-6 flex gap-6 border-b border-line">
        <Link href="/admin/dealers" className={tab(view === "pedir")}>{tr("🔎 Pedir una pieza")}{pending ? tr(" · {n} sin respuesta", { n: pending }) : ""}</Link>
        <Link href="/admin/dealers?ver=dealers" className={tab(view === "dealers")}>{tr("🤝 Mis dealers ·")} {list.length}{lateMemos ? ` · ⏳ ${lateMemos}` : ""}</Link>
      </nav>

      {view === "dealers" ? (
        <DealerDirectory list={list} requests={requests} accounts={accounts} q={q} />
      ) : (
        <AskView list={list} requests={requests} byId={byId} doc={doc} forQuery={forQuery} client={client} />
      )}
    </>
  );
}

function DealerDirectory({ list, requests, accounts, q }: { list: Awaited<ReturnType<typeof dealers>>; requests: DealerRequest[]; accounts: Map<string, DealerAccount>; q: string }) {
  const rows = list
    .map((d) => ({ d, company: companyOf(d.notes), s: statsFor(requests.filter((r) => r.dealer_id === d.id)) }))
    .filter(({ d, company }) => !q || [d.name, d.phone, d.email, company].some((v) => v?.toLowerCase().includes(q)));
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <form className="flex gap-2">
          <input type="hidden" name="ver" value="dealers" />
          <input name="q" defaultValue={q} placeholder={tr("Buscar por nombre, empresa o teléfono")} className="w-72 border border-line bg-ink/60 px-3 py-2 text-sm" />
          <button className="border border-line px-3 py-2 text-[0.62rem] tracking-[0.18em] uppercase text-stone hover:text-ivory">{tr("Buscar")}</button>
        </form>
        <DealerAdd open={!list.length} />
      </div>
      <PricelistCard list={list} />
      {rows.length ? (
        <div className="overflow-x-auto border border-line">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-ink/60 text-left text-[0.6rem] tracking-[0.18em] uppercase text-stone">
              <tr>
                <th className="px-3 py-2.5">{tr("Dealer")}</th>
                <th className="px-3 py-2.5">{tr("Contacto")}</th>
                <th className="px-3 py-2.5 text-right">{tr("Pedidos")}</th>
                <th className="px-3 py-2.5 text-right">{tr("Respondió")}</th>
                <th className="px-3 py-2.5 text-right">{tr("La tenía")}</th>
                <th className="px-3 py-2.5">{tr("Mejor oferta")}</th>
                <th className="px-3 py-2.5">{tr("Cuenta")}</th>
                <th className="px-3 py-2.5">{tr("Último pedido")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {rows.map(({ d, company, s }) => (
                <tr key={d.id} className="hover:bg-ivory/[0.03]">
                  <td className="px-3 py-2.5">
                    <Link href={`/admin/dealers/${d.id}`} className="hover:text-brass">{d.name ?? tr("Sin nombre")}</Link>
                    {company && <p className="text-xs text-stone">{company}</p>}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-stone">{[d.phone, d.email].filter(Boolean).join(" · ") || "—"}</td>
                  <td className="px-3 py-2.5 text-right">{s.asked || "—"}</td>
                  <td className="px-3 py-2.5 text-right">{s.asked ? `${Math.round((s.answered / s.asked) * 100)}%` : "—"}</td>
                  <td className="px-3 py-2.5 text-right">{s.has || "—"}</td>
                  <td className="px-3 py-2.5 text-xs">{s.best ? `${money(s.best.price!)} · ${s.best.query}` : "—"}</td>
                  <td className="px-3 py-2.5 text-xs">
                    {(() => {
                      const a = accounts.get(d.id);
                      if (!a) return "—";
                      const owes = sum(a.owesUs);
                      const late = [...a.memoFromHim, ...a.memoToHim].filter((m) => m.days != null && m.days > 0).length;
                      const soon = memosDueSoon(a).length - late;
                      const memos = a.memoFromHim.length + a.memoToHim.length;
                      return (
                        <Link href={`/admin/dealers/${d.id}`} className="grid gap-0.5">
                          {owes > 0 && <span className="text-amber-200">{tr("Nos debe {m}", { m: money(owes) })}</span>}
                          {a.weOwe.length > 0 && <span className="text-amber-200">{tr("Le debemos {n} pieza(s)", { n: a.weOwe.length })}</span>}
                          {late > 0 && <span className="text-red-200">{tr("⏳ {n} memo(s) vencido(s)", { n: late })}</span>}
                          {soon > 0 && <span className="text-stone">{tr("{n} memo(s) vencen pronto", { n: soon })}</span>}
                          {late === 0 && soon === 0 && memos > 0 && <span className="text-stone">{tr("{n} memo(s) en curso", { n: memos })}</span>}
                          {!owes && !a.weOwe.length && !memos && <span className="text-stone">—</span>}
                        </Link>
                      );
                    })()}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-stone">{s.last ? fmtDate(s.last) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-stone">{q ? tr("Ningún dealer coincide con la búsqueda.") : tr("Aún no tienes dealers. Añade el primero con «+ Nuevo dealer».")}</p>
      )}
    </div>
  );
}

function AskView({ list, requests, byId, doc, forQuery, client }: { forQuery: string; client: { id: string; name: string | null } | null; list: Awaited<ReturnType<typeof dealers>>; requests: DealerRequest[]; byId: Map<string, Awaited<ReturnType<typeof dealers>>[number]>; doc: { id: string; number: string; items: unknown; total: number | null; client_name: string | null } | null }) {
  // Búsquedas agrupadas (misma consulta y mismo día/encargo)
  const groups = new Map<string, DealerRequest[]>();
  for (const r of requests) {
    const k = `${r.document_id ?? ""}|${r.query}|${r.asked_at.slice(0, 10)}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const line = (doc?.items as { title: string; details?: string | null }[] | undefined)?.[0];
  const prefill = line ? [line.title, line.details].filter(Boolean).join(", ") : forQuery;

  return (
    <>
      <Card title={doc ? `${tr("🤝 Pedir a mis dealers")} · ${tr("encargo {n} de {c}", { n: doc.number, c: doc.client_name ?? "" })}` : client ? `${tr("🤝 Pedir a mis dealers")} · ${tr("para {c}", { c: client.name ?? tr("el cliente") })}` : "🤝 Pedir una pieza a mis dealers"}>
        {list.length ? (
          <DealerAsk
            dealers={list.map((d) => ({ id: d.id, name: d.name, phone: d.phone, reachable: Boolean(d.wa_id || d.phone) }))}
            query={prefill}
            budget={doc ? Number(doc.total) : null}
            documentId={doc?.id ?? null}
            customerId={client?.id ?? null}
          />
        ) : (
          <div className="grid gap-3">
            <p className="text-sm text-stone">{tr("Aún no tienes dealers. Añade el primero aquí (o, si ya es cliente, pulsa la etiqueta")} <b>{tr("Dealer")}</b> {tr("en su ficha).")}</p>
            <DealerAdd open />
          </div>
        )}
      </Card>

      <h2 className="mt-8 mb-3 text-[0.66rem] tracking-[0.24em] uppercase text-stone">{tr("Pedidos y respuestas")}</h2>
      {groups.size ? (
        <div className="grid gap-4">
          {[...groups.values()].slice(0, 40).map((g) => {
            const first = g[0];
            const offers = g.filter((r) => r.price).sort((a, b) => Number(a.price) - Number(b.price));
            return (
              <Card key={first.id} title={`${first.query}${first.budget ? ` · presupuesto ${money(first.budget)}` : ""} · ${fmtDate(first.asked_at)}`}>
                {first.document_id && <Link href={`/admin/documentos/${first.document_id}`} className="mb-3 inline-block text-xs text-brass hover:text-ivory">{tr("Ver el encargo →")}</Link>}
                {offers.length > 0 && <p className="mb-3 text-sm text-emerald-200">{tr("Mejor precio:")} {money(offers[0].price!)} · {byId.get(offers[0].dealer_id)?.name ?? "dealer"}</p>}
                <ul className="divide-y divide-line/60">
                  {g.map((r) => {
                    const d = byId.get(r.dealer_id);
                    return <DealerRequestRow key={r.id} r={r} dealer={d} title={<Link href={`/admin/dealers/${r.dealer_id}`} className="hover:text-brass">{d?.name ?? tr("Dealer")}</Link>} />;
                  })}
                </ul>
              </Card>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-stone">{tr("Todavía no has pedido nada a tus dealers.")}</p>
      )}
    </>
  );
}

// 📤 Lista de precios para dealers: enlace privado, descuento general y envío por WhatsApp a cada dealer
async function PricelistCard({ list }: { list: Awaited<ReturnType<typeof dealers>> }) {
  const { data } = await adminDb().from("integration_settings").select("value").eq("key", "dealer_pricelist_token").maybeSingle();
  const token = (data?.value as string | undefined) ?? null;
  const [disc, items] = await Promise.all([dealerDiscount(), dealerItems().catch(() => [])]);
  const url = token ? pricelistUrl(token) : null;
  const reachable = list.filter((d) => d.wa_id || d.phone);
  return (
    <Card title="📤 Mi lista de precios para dealers">
      <p className="mb-3 text-sm text-stone">{tr("Tu stock disponible a precio de dealer, en inglés y sin costos ni seriales. Precio de dealer: el de la ficha del reloj o, si está vacío, el de venta menos el descuento general.")}</p>
      <form action={dealerDiscountAction} className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-stone">{tr("Descuento general para dealers:")}</span>
        <input name="discount" defaultValue={disc} inputMode="decimal" className="w-16 border border-line bg-ink/60 px-2 py-1 text-right text-sm" />
        <span className="text-stone">%</span>
        <button className="border border-line px-2.5 py-1 text-[0.6rem] tracking-[0.16em] uppercase text-stone hover:text-ivory">{tr("Guardar")}</button>
        <span className="text-xs text-stone">· {tr("{n} reloj(es) en la lista", { n: items.length })}</span>
      </form>
      {url ? (
        <div className="grid gap-3">
          <p className="flex flex-wrap items-center gap-3 text-xs">
            <span className="break-all text-stone">{url}</span>
            <a href={url} target="_blank" rel="noreferrer" className="text-brass hover:text-ivory">{tr("Ver")}</a>
            <form action={pricelistAction.bind(null, true)}><button className="text-stone underline hover:text-ivory">{tr("Cambiar el enlace")}</button></form>
          </p>
          {reachable.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {reachable.map((d) => (
                <a key={d.id} href={waLink(d, pricelistMessage(d.name, url)) ?? "#"} target="_blank" rel="noreferrer" className="border border-emerald-300/40 px-2.5 py-1 text-[0.6rem] tracking-[0.14em] uppercase text-emerald-200 hover:bg-emerald-300/10">📲 {d.name ?? d.phone}</a>
              ))}
            </div>
          )}
        </div>
      ) : (
        <form action={pricelistAction.bind(null, false)}>
          <button className="border border-line px-4 py-2 text-[0.66rem] tracking-[0.2em] uppercase text-stone hover:text-ivory">{tr("Crear el enlace de la lista")}</button>
        </form>
      )}
    </Card>
  );
}
