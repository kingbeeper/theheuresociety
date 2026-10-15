import "server-only";
import { adminDb } from "./supabase";
import { margin, salesByChannel, summarize, type Item } from "./stock";
import { balanceDue, paidSoFar, type Doc } from "./doc-labels";
import { expensesBetween, sumExpenses } from "./expenses";
import { priceVsMarket } from "./market";
import { SOURCE_LABEL } from "./crm-labels";
import { escapeHtml as h } from "./telegram";

// Resumen semanal (lunes, con el de las 8:00): cómo fue la semana pasada y qué queda abierto.

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://theheuresociety.vercel.app").replace(/\/$/, "");
const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const DAY = 86_400_000;

export async function buildWeekly(now = Date.now()) {
  const db = adminDb();
  const since = new Date(now - 7 * DAY);
  const sinceIso = since.toISOString();
  const sinceDay = sinceIso.slice(0, 10);
  const [{ data: items }, { data: leads }, { data: appts }, { data: openDocs }, { data: paidDocs }, expenses] = await Promise.all([
    db.from("inventory_items").select("*"),
    db.from("customers").select("source, stage, created_at").gte("created_at", sinceIso),
    db.from("appointments").select("starts_at, status, outcome").gte("starts_at", sinceIso).lt("starts_at", new Date(now + 7 * DAY).toISOString()),
    db.from("documents").select("*").in("kind", ["quote", "invoice", "proforma", "sourcing"]).in("status", ["sent", "accepted"]),
    db.from("documents").select("*").in("kind", ["invoice", "proforma", "sourcing"]).gte("updated_at", sinceIso),
    expensesBetween(sinceDay).catch(() => []),
  ]);
  const all = (items ?? []) as Item[];
  const s = summarize(all, now);

  // Ventas de la semana
  const sold = all.filter((i) => i.status === "sold" && i.sale_date && i.sale_date >= sinceDay);
  const revenue = sold.reduce((a, i) => a + Number(i.sale_price ?? 0), 0);
  const profit = sold.reduce((a, i) => a + (margin(i)?.amount ?? 0), 0);
  const channels = await salesByChannel(all, since.getTime());
  const spent = sumExpenses(expenses);

  // Cobros: facturas pagadas (su saldo), depósitos de proformas y anticipos de encargos
  let collected = 0;
  for (const d of (paidDocs ?? []) as Doc[]) {
    if (d.kind === "invoice" && d.status === "paid" && d.paid_at && d.paid_at >= sinceDay) collected += d.payments?.length ? Number(d.payments[d.payments.length - 1].amount) : balanceDue(d);
    if (d.kind === "proforma") for (const p of (d.status === "converted" ? (d.payments ?? []).slice(0, -1) : d.payments ?? [])) if (p.date >= sinceDay) collected += Number(p.amount);
    if (d.kind === "sourcing" && d.deposit_paid_at && d.deposit_paid_at >= sinceDay) collected += Number(d.deposit ?? 0);
  }

  // Leads nuevos por canal
  const bySource = new Map<string, number>();
  for (const l of leads ?? []) bySource.set(l.source as string, (bySource.get(l.source as string) ?? 0) + 1);

  // Citas: las de la semana pasada (y cómo fueron) y las de esta semana
  const past = (appts ?? []).filter((a) => a.starts_at < new Date(now).toISOString() && a.status !== "cancelled");
  const next = (appts ?? []).filter((a) => a.starts_at >= new Date(now).toISOString() && a.status !== "cancelled");
  const bought = past.filter((a) => a.outcome === "bought").length;

  // Abierto: cotizaciones, por cobrar y depósitos
  const docs = (openDocs ?? []) as Doc[];
  const quotes = docs.filter((d) => d.kind === "quote");
  const receivable = docs.filter((d) => d.kind === "invoice").reduce((a, d) => a + balanceDue(d), 0) + docs.filter((d) => d.kind === "proforma").reduce((a, d) => a + Math.max(0, Number(d.total) - paidSoFar(d)), 0);

  // Precios frente al mercado
  const stock = all.filter((i) => i.status === "in_stock" || i.status === "reserved");
  const vs = stock.map((i) => ({ i, v: priceVsMarket({ asking_price: i.asking_price, market_low: i.market_low ?? null, market_high: i.market_high ?? null, market_typical: i.market_typical ?? null }) }));
  const high = vs.filter((x) => x.v?.state === "high");
  const low = vs.filter((x) => x.v?.state === "low");

  const lines = [
    "📊 <b>Resumen de la semana</b>",
    "",
    `💰 <b>Ventas:</b> ${sold.length} reloj(es) · ${usd(revenue)} · ganancia ${usd(profit)}`,
    ...channels.map((c) => `   ${h(SOURCE_LABEL[c.source] ?? (c.source === "unknown" ? "Sin canal" : c.source))}: ${c.count} · ${usd(c.revenue)}`),
    `💵 <b>Cobrado:</b> ${usd(collected)} · 🏢 gastos del negocio ${usd(spent)}`,
    `📈 <b>Ganancia real de la semana:</b> ${usd(profit - spent)}`,
    "",
    `🆕 <b>Leads nuevos:</b> ${leads?.length ?? 0}${bySource.size ? ` (${[...bySource.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${SOURCE_LABEL[k] ?? k} ${n}`).join(", ")})` : ""}`,
    `📅 <b>Citas:</b> ${past.length} la semana pasada${past.length ? ` (${bought} compraron)` : ""} · ${next.length} esta semana`,
    "",
    `📄 <b>Abierto:</b> ${quotes.length} cotización(es) por ${usd(quotes.reduce((a, d) => a + Number(d.total), 0))} · por cobrar ${usd(receivable)}`,
    `⌚ <b>Inventario:</b> ${s.inStock} reloj(es) · ${s.aged.length} con más de 90 días${s.owed.length ? ` · debes ${usd(s.owedAmount)} a dueños` : ""}`,
  ];
  if (high.length || low.length) {
    lines.push("", "🏷 <b>Precios frente al mercado</b> (Chrono24, WatchCharts…)");
    for (const x of high.slice(0, 5)) lines.push(`   ⬆️ ${h(x.i.sku)} ${h(x.i.brand)} ${h(x.i.model ?? "")}: ${usd(Number(x.i.asking_price))} · mercado ${usd(Number(x.i.market_low))}–${usd(Number(x.i.market_high))}`);
    for (const x of low.slice(0, 5)) lines.push(`   ⬇️ ${h(x.i.sku)} ${h(x.i.brand)} ${h(x.i.model ?? "")}: ${usd(Number(x.i.asking_price))} · mercado ${usd(Number(x.i.market_low))}–${usd(Number(x.i.market_high))}`);
  }
  lines.push("", `${SITE}/admin/dinero`);
  return lines.join("\n");
}
