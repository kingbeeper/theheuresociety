import { tr } from "@/lib/admin-i18n";
import Link from "next/link";
import { connection } from "next/server";
import { requireUser } from "@/lib/admin-auth";
import { adminDb } from "@/lib/supabase";
import { SOURCE_LABEL, type Stage } from "@/lib/crm-labels";
import { balanceDue, paidSoFar, type Doc } from "@/lib/doc-labels";
import { ago, PageTitle, requestTime } from "@/components/admin/ui";
import { PipelineBoard, type PipelineCard } from "@/components/admin/PipelineBoard";

export const metadata = { title: "Embudo de ventas" };

// Embudo: clientes activos por etapa (los ganados, solo los del último mes). El valor de cada uno es
// lo que tiene abierto: cotizaciones, saldo de proformas y facturas por cobrar.
export default async function PipelinePage() {
  await connection();
  await requireUser("leads");
  const db = adminDb();
  const now = requestTime();
  const monthAgo = new Date(now - 30 * 86_400_000).toISOString();
  const [{ data: customers }, { data: docs }] = await Promise.all([
    db.from("customers").select("id, name, phone, email, stage, source, interests, last_activity_at, follow_up_at").not("stage", "eq", "lost").or(`stage.neq.won,last_activity_at.gte.${monthAgo}`).order("last_activity_at", { ascending: false }).limit(400),
    db.from("documents").select("customer_id, kind, status, total, deposit, payments").in("kind", ["quote", "proforma", "invoice"]).in("status", ["sent", "accepted"]),
  ]);
  const value = new Map<string, number>();
  for (const d of (docs ?? []) as Doc[]) {
    if (!d.customer_id) continue;
    const v = d.kind === "quote" ? Number(d.total) : d.kind === "proforma" ? Math.max(0, Number(d.total) - paidSoFar(d)) : balanceDue(d);
    value.set(d.customer_id, (value.get(d.customer_id) ?? 0) + v);
  }
  const cards: PipelineCard[] = (customers ?? []).map((c) => ({
    id: c.id as string,
    name: (c.name ?? c.phone ?? c.email ?? "Sin nombre") as string,
    stage: c.stage as Stage,
    source: SOURCE_LABEL[c.source as string] ?? (c.source as string),
    wants: c.interests ? String(c.interests).split("\n").filter(Boolean).slice(-1)[0] : null,
    value: value.get(c.id as string) ?? 0,
    ago: ago(c.last_activity_at as string, now),
    followUp: c.follow_up_at ? (c.follow_up_at as string) : null,
  }));
  const open = cards.filter((c) => c.stage !== "won").reduce((a, c) => a + c.value, 0);

  return (
    <>
      <Link href="/admin/leads" className="text-[0.66rem] tracking-[0.2em] uppercase text-stone hover:text-ivory">{tr("← Leads")}</Link>
      <PageTitle eyebrow="Leads" title="Embudo de ventas" />
      <p className="mb-4 text-sm text-stone">
        {tr("Arrastra un cliente a otra columna para cambiar su etapa. Valor abierto en el embudo:")} <b className="text-ivory">${Math.round(open).toLocaleString("en-US")}</b> {tr("(cotizaciones, saldos de proformas y facturas por cobrar). Los perdidos no salen; los ganados, solo los del último mes.")}
      </p>
      <PipelineBoard cards={cards} />
    </>
  );
}
