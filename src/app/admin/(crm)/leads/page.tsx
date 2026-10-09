import Link from "next/link";
import { connection } from "next/server";
import { adminDb } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";
import { followUpsDue, INTENT_LABEL, SOURCE_LABEL, STAGES, STAGE_LABEL, type Customer, type Stage } from "@/lib/crm";
import { ago, buttonClass, fieldClass, labelClass, money, PageTitle, SourceTag, requestTime } from "@/components/admin/ui";
import { StageSelect } from "@/components/admin/StageSelect";
import { createLead } from "../../actions";
import { todayInMiami } from "@/lib/booking";
import { customerValues } from "@/lib/customer-value";

export const metadata = { title: "Leads" };

export default async function LeadsPage({ searchParams }: PageProps<"/admin/leads">) {
  await connection();
  // La plantilla y la página se generan en paralelo: cada página comprueba la sesión antes de leer datos
  await requireAdmin();
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const stage = one(sp.stage) as Stage | "";
  const source = one(sp.source);
  const q = one(sp.q).trim();
  const botOff = one(sp.bot) === "off";
  const withAlerts = one(sp.alerts) === "1";
  const followOnly = one(sp.follow) === "1";
  const vipOnly = one(sp.vip) === "1";

  const db = adminDb();
  let query = db.from("customers").select("*").order("last_activity_at", { ascending: false }).limit(300);
  if (stage && STAGES.includes(stage)) query = query.eq("stage", stage);
  if (source) query = query.eq("source", source);
  if (q) {
    const safe = q.replace(/[,()"%]/g, " ");
    query = query.or(`name.ilike.%${safe}%,phone.ilike.%${safe}%,email.ilike.%${safe}%,interests.ilike.%${safe}%`);
  }
  // Filtros especiales del panel: chats atendidos por una persona y clientes con búsquedas activas
  if (botOff) {
    const { data } = await db.from("wa_contacts").select("customer_id").eq("mode", "human").gt("human_until", new Date(requestTime()).toISOString());
    query = query.in("id", (data ?? []).map((r) => r.customer_id).filter(Boolean) as string[]);
  }
  if (withAlerts) {
    const { data } = await db.from("watch_alerts").select("customer_id").eq("active", true);
    query = query.in("id", [...new Set((data ?? []).map((r) => r.customer_id as string))]);
  }
  if (vipOnly) {
    const all = await customerValues();
    query = query.in("id", [...all.entries()].filter(([, v]) => v.vip).map(([id]) => id));
  }
  if (followOnly) {
    const due = await followUpsDue(requestTime(), todayInMiami(new Date(requestTime())));
    query = query.in("id", due.map((f) => f.id));
  }
  const [{ data: rows }, { data: counts }] = await Promise.all([query, db.from("customers").select("stage")]);
  const leads = (rows ?? []) as Customer[];
  const values = await customerValues(leads.map((c) => c.id));
  const spent = (id: string) => {
    const v = values.get(id);
    return v && v.purchases ? `${v.vip ? "⭐ " : ""}${money(v.spent)} · ${v.purchases} compra${v.purchases > 1 ? "s" : ""}` : null;
  };
  const count = (s: string) => (counts ?? []).filter((c) => c.stage === s).length;
  const now = requestTime();

  const tab = (s: string, label: string, n: number) => {
    const params = new URLSearchParams({ ...(s && { stage: s }), ...(source && { source }), ...(q && { q }) });
    return (
      <Link
        key={s || "all"}
        href={`/admin/leads${params.size ? `?${params}` : ""}`}
        className={`whitespace-nowrap border-b-2 px-3 py-2 text-[0.66rem] tracking-[0.18em] uppercase ${
          stage === s ? "border-brass text-ivory" : "border-transparent text-stone hover:text-ivory"
        }`}
      >
        {label} <span className="text-stone/70">{n}</span>
      </Link>
    );
  };

  return (
    <>
      <PageTitle
        eyebrow="CRM"
        title="Leads"
        action={
          <details className="group relative">
            <summary className={`${buttonClass} cursor-pointer list-none`}>+ Nuevo lead</summary>
            <form action={createLead} className="absolute right-0 z-20 mt-2 grid w-[min(92vw,420px)] gap-4 border border-line bg-forest p-5 shadow-2xl">
              <label><span className={labelClass}>Nombre</span><input name="name" className={fieldClass} required /></label>
              <div className="grid grid-cols-2 gap-3">
                <label><span className={labelClass}>Teléfono</span><input name="phone" className={fieldClass} /></label>
                <label><span className={labelClass}>Correo</span><input name="email" type="email" className={fieldClass} /></label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label>
                  <span className={labelClass}>Origen</span>
                  <select name="source" className={fieldClass} defaultValue="walk_in">
                    {Object.entries(SOURCE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </label>
                <label>
                  <span className={labelClass}>Quiere</span>
                  <select name="intent" className={fieldClass} defaultValue="buy">
                    {Object.entries(INTENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </label>
              </div>
              <label><span className={labelClass}>Qué busca</span><input name="interests" className={fieldClass} placeholder="Ej.: Daytona acero, hasta $35k" /></label>
              <button className={buttonClass}>Crear lead</button>
            </form>
          </details>
        }
      />

      <div className="mb-5 flex gap-1 overflow-x-auto border-b border-line">
        {tab("", "Todos", counts?.length ?? 0)}
        {STAGES.map((s) => tab(s, STAGE_LABEL[s], count(s)))}
      </div>

      <form className="mb-6 flex flex-wrap gap-3" action="/admin/leads">
        {stage && <input type="hidden" name="stage" value={stage} />}
        <input name="q" defaultValue={q} placeholder="Buscar nombre, teléfono, correo o interés…" className={`${fieldClass} max-w-md flex-1`} />
        <select name="source" defaultValue={source} className={`${fieldClass} w-auto`}>
          <option value="">Todos los orígenes</option>
          {Object.entries(SOURCE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button className="border border-line px-4 text-[0.66rem] tracking-[0.2em] uppercase text-stone hover:text-ivory">Filtrar</button>
        <Link href="/admin/leads?vip=1" className={`self-center text-xs underline ${vipOnly ? "text-brass" : "text-stone hover:text-ivory"}`}>⭐ Mejores clientes</Link>
        {(q || source || botOff || withAlerts || followOnly || vipOnly) && (
          <Link href="/admin/leads" className="self-center text-xs text-stone underline hover:text-ivory">Quitar filtros</Link>
        )}
      </form>

      {/* Móvil: tarjetas (la tabla solo cabe en pantallas anchas) */}
      {leads.length > 0 && (
        <ul className="divide-y divide-line/60 border border-line md:hidden">
          {leads.map((c) => (
            <li key={c.id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <Link href={`/admin/leads/${c.id}`} className="min-w-0 hover:text-brass">
                  <p className="truncate">{c.name ?? "Sin nombre"}</p>
                  <p className="truncate text-xs text-stone">{c.phone ?? c.email ?? ""}</p>
                  {spent(c.id) && <p className="text-xs text-brass">{spent(c.id)}</p>}
                </Link>
                <span className="shrink-0 text-xs text-stone">{ago(c.last_activity_at, now)}</span>
              </div>
              {c.interests && <p className="mt-1 truncate text-sm text-stone">{c.interests}</p>}
              <div className="mt-2 flex items-center justify-between gap-3">
                <SourceTag source={c.source} />
                <StageSelect id={c.id} stage={c.stage} />
              </div>
            </li>
          ))}
        </ul>
      )}

      {leads.length ? (
        <div className="hidden overflow-x-auto border border-line md:block">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-forest text-left text-[0.62rem] tracking-[0.2em] uppercase text-stone">
              <tr>
                <th className="px-4 py-3 font-normal">Cliente</th>
                <th className="px-4 py-3 font-normal">Busca / quiere</th>
                <th className="px-4 py-3 font-normal">Origen</th>
                <th className="px-4 py-3 font-normal">Etapa</th>
                <th className="px-4 py-3 font-normal">Actividad</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {leads.map((c) => (
                <tr key={c.id} className="hover:bg-forest/60">
                  <td className="px-4 py-3">
                    <Link href={`/admin/leads/${c.id}`} className="hover:text-brass">{c.name ?? "Sin nombre"}</Link>
                    <p className="text-xs text-stone">{c.phone ?? c.email ?? ""}</p>
                    {spent(c.id) && <p className="text-xs text-brass">{spent(c.id)}</p>}
                  </td>
                  <td className="max-w-[280px] px-4 py-3">
                    <p className="truncate">{c.interests ?? "—"}</p>
                    <p className="text-xs text-stone">{c.intent ? INTENT_LABEL[c.intent] ?? c.intent : ""}{c.tags.length ? ` · ${c.tags.join(", ")}` : ""}</p>
                  </td>
                  <td className="px-4 py-3"><SourceTag source={c.source} /></td>
                  <td className="px-4 py-3"><StageSelect id={c.id} stage={c.stage} /></td>
                  <td className="px-4 py-3 text-xs text-stone">{ago(c.last_activity_at, now)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="border border-line bg-forest/60 p-8 text-center text-sm text-stone">No hay leads con estos filtros.</p>
      )}
    </>
  );
}
