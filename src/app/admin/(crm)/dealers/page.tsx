import Link from "next/link";
import { connection } from "next/server";
import { requireUser } from "@/lib/admin-auth";
import { adminDb } from "@/lib/supabase";
import { dealerMessage, dealers, REQUEST_STATUS, waLink, type DealerRequest } from "@/lib/dealers";
import { Card, fmtDate, PageTitle } from "@/components/admin/ui";
import { DealerAsk } from "@/components/admin/DealerAsk";
import { DealerAdd } from "@/components/admin/DealerAdd";
import { answerDealerAction } from "../../actions";

export const metadata = { title: "Dealers" };

// Red de dealers: pedirles una pieza (suelta o de un encargo) y anotar quién la tiene y a qué precio.
export default async function DealersPage({ searchParams }: PageProps<"/admin/dealers">) {
  await connection();
  await requireUser("leads");
  const sp = await searchParams;
  const encargo = typeof sp.encargo === "string" ? sp.encargo : null;
  const db = adminDb();
  const [list, { data: reqRows }, { data: doc }] = await Promise.all([
    dealers(),
    db.from("dealer_requests").select("*").order("asked_at", { ascending: false }).limit(200),
    encargo ? db.from("documents").select("id, number, items, total, client_name").eq("id", encargo).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const requests = (reqRows ?? []) as DealerRequest[];
  const byId = new Map(list.map((d) => [d.id, d]));
  // Búsquedas agrupadas (misma consulta y mismo día/encargo)
  const groups = new Map<string, DealerRequest[]>();
  for (const r of requests) {
    const k = `${r.document_id ?? ""}|${r.query}|${r.asked_at.slice(0, 10)}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const line = (doc?.items as { title: string; details?: string | null }[] | undefined)?.[0];
  const prefill = line ? [line.title, line.details].filter(Boolean).join(", ") : "";
  const btn = "border px-2 py-1 text-[0.6rem] tracking-[0.14em] uppercase";

  return (
    <>
      <Link href="/admin/leads" className="text-[0.66rem] tracking-[0.2em] uppercase text-stone hover:text-ivory">← Leads</Link>
      <PageTitle eyebrow="CRM" title="Dealers" />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card title={doc ? `🤝 Pedir a mis dealers · encargo ${doc.number} de ${doc.client_name ?? ""}` : "🤝 Pedir una pieza a mis dealers"}>
          {list.length ? (
            <DealerAsk
              dealers={list.map((d) => ({ id: d.id, name: d.name, phone: d.phone, reachable: Boolean(d.wa_id || d.phone) }))}
              query={prefill}
              budget={doc ? Number(doc.total) : null}
              documentId={doc?.id ?? null}
            />
          ) : (
            <p className="text-sm text-stone">Aún no tienes dealers. Añádelos con <b>+ Nuevo dealer</b> (a la derecha) o, si ya son clientes, pulsa la etiqueta <b>Dealer</b> en su ficha.</p>
          )}
        </Card>

        <Card title={`Mis dealers · ${list.length}`}>
          <div className="mb-4"><DealerAdd open={!list.length} /></div>
          {list.length ? (
            <ul className="space-y-1.5 text-sm">
              {list.map((d) => {
                const answered = requests.filter((r) => r.dealer_id === d.id && r.status !== "asked").length;
                const asked = requests.filter((r) => r.dealer_id === d.id).length;
                return (
                  <li key={d.id} className="flex justify-between gap-3 border-b border-line/60 pb-1.5">
                    <Link href={`/admin/leads/${d.id}`} className="truncate hover:text-brass">{d.name ?? d.phone ?? "Dealer"}</Link>
                    <span className="shrink-0 text-xs text-stone">{asked ? `respondió ${answered} de ${asked}` : "sin pedidos"}</span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-stone">También puedes marcar a un cliente que ya tengas con la etiqueta «Dealer» en su ficha.</p>
          )}
        </Card>
      </div>

      <h2 className="mt-8 mb-3 text-[0.66rem] tracking-[0.24em] uppercase text-stone">Pedidos y respuestas</h2>
      {groups.size ? (
        <div className="grid gap-4">
          {[...groups.values()].map((g) => {
            const first = g[0];
            const offers = g.filter((r) => r.price).sort((a, b) => Number(a.price) - Number(b.price));
            return (
              <Card key={first.id} title={`${first.query}${first.budget ? ` · presupuesto $${Math.round(Number(first.budget)).toLocaleString("en-US")}` : ""} · ${fmtDate(first.asked_at)}`}>
                {first.document_id && <Link href={`/admin/documentos/${first.document_id}`} className="mb-3 inline-block text-xs text-brass hover:text-ivory">Ver el encargo →</Link>}
                {offers.length > 0 && <p className="mb-3 text-sm text-emerald-200">Mejor precio: ${Math.round(Number(offers[0].price)).toLocaleString("en-US")} · {byId.get(offers[0].dealer_id)?.name ?? "dealer"}</p>}
                <ul className="divide-y divide-line/60">
                  {g.map((r) => {
                    const d = byId.get(r.dealer_id);
                    const wa = d ? waLink(d, dealerMessage(r.query, r.budget ? Number(r.budget) : null, d.name)) : null;
                    return (
                      <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm">
                        <div className="min-w-0">
                          <p className="truncate">{d?.name ?? "Dealer"} <span className={`text-xs ${r.status === "no" ? "text-stone" : r.status === "asked" ? "text-amber-200" : "text-emerald-200"}`}>· {REQUEST_STATUS[r.status]}{r.price ? ` · $${Math.round(Number(r.price)).toLocaleString("en-US")}` : ""}</span></p>
                          {r.note && <p className="text-xs text-stone">{r.note}</p>}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {wa && <a href={wa} target="_blank" rel="noreferrer" className={`${btn} border-emerald-300/40 text-emerald-200 hover:bg-emerald-300/10`}>📲 WhatsApp</a>}
                          <form action={answerDealerAction.bind(null, r.id)} className="flex items-center gap-1.5">
                            <input name="price" inputMode="decimal" placeholder="Precio $" defaultValue={r.price ?? ""} className="w-24 border border-line bg-ink/60 px-2 py-1 text-xs" />
                            <input name="note" placeholder="Nota (año, set…)" defaultValue={r.note ?? ""} className="w-36 border border-line bg-ink/60 px-2 py-1 text-xs" />
                            <button name="status" value="has" className={`${btn} border-line text-stone hover:text-ivory`}>La tiene</button>
                            <button name="status" value="no" className={`${btn} border-line text-stone hover:text-ivory`}>No</button>
                          </form>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-stone">Todavía no has pedido nada a tus dealers.</p>
      )}
    </>
  );
}
