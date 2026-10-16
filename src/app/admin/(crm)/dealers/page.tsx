import { tr } from "@/lib/admin-i18n";
import Link from "next/link";
import { connection } from "next/server";
import { requireUser } from "@/lib/admin-auth";
import { adminDb } from "@/lib/supabase";
import { companyOf, dealers, statsFor, type DealerRequest } from "@/lib/dealers";
import { Card, fmtDate, PageTitle } from "@/components/admin/ui";
import { DealerAsk } from "@/components/admin/DealerAsk";
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

  return (
    <>
      <Link href="/admin/leads" className="text-[0.66rem] tracking-[0.2em] uppercase text-stone hover:text-ivory">{tr("← Leads")}</Link>
      <PageTitle eyebrow="CRM" title="Dealers" />
      <nav className="mb-6 flex gap-6 border-b border-line">
        <Link href="/admin/dealers" className={tab(view === "pedir")}>{tr("🔎 Pedir una pieza")}{pending ? tr(" · {n} sin respuesta", { n: pending }) : ""}</Link>
        <Link href="/admin/dealers?ver=dealers" className={tab(view === "dealers")}>{tr("🤝 Mis dealers ·")} {list.length}</Link>
      </nav>

      {view === "dealers" ? (
        <DealerDirectory list={list} requests={requests} q={q} />
      ) : (
        <AskView list={list} requests={requests} byId={byId} doc={doc} forQuery={forQuery} client={client} />
      )}
    </>
  );
}

function DealerDirectory({ list, requests, q }: { list: Awaited<ReturnType<typeof dealers>>; requests: DealerRequest[]; q: string }) {
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
