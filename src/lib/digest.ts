import "server-only";
import { adminDb } from "./supabase";
import { escapeHtml as h, notifyAdmins } from "./telegram";
import { SOURCE_LABEL } from "./crm-labels";
import { followUpsDue } from "./crm";
import { summarize, type Item } from "./stock";
import { miamiToUtc, TIME_ZONE, todayInMiami } from "./booking";
import { SITE_URL } from "./seo";

// Resumen diario por Telegram (8:00 de Miami): todo lo que pide atención hoy, en un mensaje.

const DAY = 86_400_000;
const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const fmt = (n: number | null | undefined) => (n == null ? "—" : Math.round(n).toLocaleString("es-ES"));

export async function buildDigest(now = Date.now()) {
  const db = adminDb();
  const since = new Date(now - DAY).toISOString();
  const nowIso = new Date(now).toISOString();
  const today = todayInMiami(new Date(now));
  const dayStart = miamiToUtc(today, "00:00").toISOString();
  const dayEnd = new Date(miamiToUtc(today, "00:00").getTime() + DAY).toISOString();
  const yesterday = new Date(now - DAY).toISOString().slice(0, 10);
  const twoDaysAgo = new Date(now - 2 * DAY).toISOString().slice(0, 10);

  const [leads, stale, appts, sells, waWaiting, socialWaiting, stock, igY, igPrev] = await Promise.all([
    db.from("customers").select("name, source, interests").gte("created_at", since).order("created_at", { ascending: false }),
    followUpsDue(now, todayInMiami(new Date(now))),
    db.from("appointments").select("kind, starts_at, name, status").in("status", ["requested", "confirmed"]).gte("starts_at", dayStart).lt("starts_at", dayEnd).order("starts_at"),
    db.from("sell_requests").select("status"),
    db.from("wa_contacts").select("wa_id", { count: "exact", head: true }).eq("mode", "human").gt("human_until", nowIso),
    db.from("social_contacts").select("id", { count: "exact", head: true }).eq("mode", "human").gt("human_until", nowIso),
    db.from("inventory_items").select("*"),
    db.from("social_daily").select("data").eq("platform", "instagram").eq("day", yesterday).maybeSingle(),
    db.from("social_daily").select("data").eq("platform", "instagram").lte("day", twoDaysAgo).order("day", { ascending: false }).limit(5),
  ]);
  const { data: openDocs } = await db.from("documents").select("kind, number, client_name, total, due_date").eq("status", "sent");

  const lines: string[] = [`☀️ <b>Buenos días · resumen de The Heure Society</b>`];

  // Leads
  const newLeads = leads.data ?? [];
  lines.push("", `🆕 <b>Leads nuevos (24 h): ${newLeads.length}</b>`);
  for (const l of newLeads.slice(0, 6)) {
    lines.push(`• ${h(l.name ?? "Sin nombre")} · ${h(SOURCE_LABEL[l.source as string] ?? l.source)}${l.interests ? ` · ${h(String(l.interests).split("\n")[0].slice(0, 60))}` : ""}`);
  }

  // Seguimientos: programados y leads que se han quedado quietos
  if (stale.length) {
    lines.push("", `⏰ <b>Seguimientos para hoy: ${stale.length}</b>`);
    for (const f of stale.slice(0, 8)) lines.push(`• ${h(f.name ?? "Sin nombre")} · ${h(f.reason)}`);
    if (stale.length > 8) lines.push(`…y ${stale.length - 8} más: ${SITE_URL}/admin/leads?follow=1`);
  }

  // Citas de hoy
  const todayAppts = appts.data ?? [];
  lines.push("", `📅 <b>Citas de hoy: ${todayAppts.length}</b>`);
  for (const a of todayAppts) {
    const time = new Intl.DateTimeFormat("es-ES", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit" }).format(new Date(a.starts_at as string));
    lines.push(`• ${time} · ${h(a.name as string)} · ${a.kind === "office" ? "oficina" : "videollamada"}${a.status === "requested" ? " · <i>sin confirmar</i>" : ""}`);
  }

  // Pendientes
  const reqs = sells.data ?? [];
  const pendingOffers = reqs.filter((r) => r.status === "new").length;
  const waiting = (waWaiting.count ?? 0) + (socialWaiting.count ?? 0);
  if (pendingOffers || waiting) {
    lines.push("", "📌 <b>Pendientes</b>");
    if (pendingOffers) lines.push(`• ${pendingOffers} reloj(es) ofrecido(s) sin responder`);
    if (waiting) lines.push(`• ${waiting} chat(s) esperando a una persona`);
  }

  // Inventario
  const items = (stock.data ?? []) as Item[];
  if (items.length) {
    const s = summarize(items, now);
    lines.push("", `⌚ <b>Inventario: ${s.inStock} disponibles</b> · ventas del mes ${usd(s.salesMonth)} · ganancia ${usd(s.profitMonth)}`);
    if (s.owed.length) lines.push(`• 💵 ${usd(s.owedAmount)} por pagar a dueños (${s.owed.length})`);
    if (s.memoDue.length) lines.push(`• ⏳ ${s.memoDue.length} memo(s) por devolver esta semana`);
    if (s.aged.length) lines.push(`• 🕰 ${s.aged.length} reloj(es) con +90 días: revisa el precio`);
    if (s.missingCost.length) lines.push(`• ✎ ${s.missingCost.length} reloj(es) sin costo`);
  }

  // Documentos: facturas por cobrar, memos fuera y cotizaciones que caducan
  const docs = openDocs ?? [];
  const unpaid = docs.filter((d) => d.kind === "invoice");
  const overdue = unpaid.filter((d) => d.due_date && d.due_date < today);
  const memosLate = docs.filter((d) => d.kind === "memo" && d.due_date && d.due_date < today);
  const quotesEnding = docs.filter((d) => d.kind === "quote" && d.due_date && d.due_date >= today && d.due_date <= new Date(now + 2 * DAY).toISOString().slice(0, 10));
  const consignEnding = docs.filter((d) => d.kind === "consignment" && d.due_date && d.due_date <= new Date(now + 7 * DAY).toISOString().slice(0, 10));
  if (unpaid.length || memosLate.length || quotesEnding.length || consignEnding.length) {
    lines.push("", "📄 <b>Documentos</b>");
    if (unpaid.length) lines.push(`• ${usd(unpaid.reduce((a, d) => a + Number(d.total), 0))} por cobrar (${unpaid.length} factura/s${overdue.length ? `, ${overdue.length} vencida/s` : ""})`);
    for (const m of memosLate) lines.push(`• ⏳ Memo ${h(m.number)} vencido · ${h(m.client_name ?? "")}`);
    for (const c of consignEnding) lines.push(`• Consignación ${h(c.number)} de ${h(c.client_name ?? "")} termina el ${c.due_date}: renovar o devolver`);
    for (const q of quotesEnding) lines.push(`• Cotización ${h(q.number)} caduca pronto · ${h(q.client_name ?? "")} · ${usd(Number(q.total))}`);
  }

  // Tareas del equipo para hoy o vencidas
  const { openTasks } = await import("./staff-tasks");
  const dueTasks = (await openTasks()).filter((t) => t.due_date && t.due_date <= today);
  if (dueTasks.length) {
    lines.push("", `📝 <b>Tareas para hoy o vencidas: ${dueTasks.length}</b>`);
    for (const t of dueTasks.slice(0, 6)) lines.push(`• ${h(t.title)} · ${h(t.assignee)}${t.due_date! < today ? " · ⚠️ vencida" : ""}`);
  }

  // Relojero: más de 3 semanas fuera o pasada la fecha prevista
  const { openServices } = await import("./services");
  const late = (await openServices()).filter((s) => (s.expected_at ? s.expected_at < today : s.sent_at < new Date(now - 21 * DAY).toISOString().slice(0, 10)));
  if (late.length) {
    lines.push("", `🔧 <b>Relojero</b>: ${late.length} reloj(es) con retraso`);
    for (const s of late.slice(0, 5)) lines.push(`• ${h(s.item?.sku ?? "")} ${h(s.item?.brand ?? "")} ${h(s.item?.model ?? "")} · ${h(s.provider)} desde ${s.sent_at}`);
  }

  // Instagram ayer
  const y = igY.data?.data as Record<string, number> | undefined;
  if (y) {
    const prevFollowers = (igPrev.data ?? []).map((r) => (r.data as Record<string, number>).followers).find((v) => v != null);
    const followers = y.followers;
    lines.push("", `📸 <b>Instagram ayer</b>: alcance ${fmt(y.reach)} · visualizaciones ${fmt(y.views)} · interacciones ${fmt(y.total_interactions)}${followers != null && prevFollowers != null ? ` · seguidores ${followers - prevFollowers >= 0 ? "+" : ""}${followers - prevFollowers}` : ""}`);
  }

  lines.push("", `${SITE_URL}/admin`);
  return lines.join("\n");
}

export async function sendDigest() {
  const text = await buildDigest();
  await notifyAdmins(text);
  // Relojes estancados: propuesta de rebaja con botón para aplicarla
  const { notifyDrops } = await import("./pricing");
  await notifyDrops().catch((e) => console.error("Rebajas sugeridas:", e));
  return text;
}
