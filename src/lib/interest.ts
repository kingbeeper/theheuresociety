import "server-only";
import { adminDb } from "./supabase";
import { addEvent, alertMatches } from "./crm";
import { STAGE_LABEL, type Stage } from "./crm-labels";
import { escapeHtml as h, notifyAdmins } from "./telegram";

// Entra un reloj al inventario (CRM, Telegram, compra, consignación, intercambio): se cruza con TODO lo
// que han pedido los clientes, sin importar cuándo — búsquedas «avísenme», recordatorios, cotizaciones,
// encargos, proformas y el «qué busca» de su ficha — y el bot avisa con la ficha de cada uno.

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://theheuresociety.vercel.app").replace(/\/$/, "");
type Watch = { brand: string; model: string | null; reference: string | null };
type Hit = { id: string; name: string | null; phone: string | null; wa_id: string | null; stage: string; reasons: string[] };

const date = (iso: string) => new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso));
const DOC_LABEL: Record<string, string> = { quote: "Cotización", sourcing: "Encargo", proforma: "Proforma" };

export async function interestedFor(w: Watch, excludeItemId?: string) {
  const watch = { brand: w.brand, model: w.model ?? "", reference: w.reference ?? "" };
  const db = adminDb();
  const [alerts, reminders, docs, leads] = await Promise.all([
    db.from("watch_alerts").select("customer_id, query, created_at").eq("active", true),
    db.from("reminders").select("customer_id, body, created_at"),
    db.from("documents").select("customer_id, kind, number, status, items, issue_date, deposit").in("kind", ["quote", "sourcing", "proforma"]).neq("status", "void").not("customer_id", "is", null),
    db.from("customers").select("id, interests").not("interests", "is", null),
  ]);

  const hits = new Map<string, string[]>();
  const add = (customerId: string | null, reason: string) => {
    if (!customerId) return;
    const list = hits.get(customerId) ?? [];
    if (!list.includes(reason)) list.push(reason);
    hits.set(customerId, list);
  };
  for (const a of alerts.data ?? []) if (alertMatches(a.query as string, watch)) add(a.customer_id as string, `🔔 Búsqueda «${a.query}» (${date(a.created_at as string)})`);
  for (const r of reminders.data ?? []) if (alertMatches(r.body as string, watch)) add(r.customer_id as string, `⏰ Recordatorio: «${String(r.body).slice(0, 90)}» (${date(r.created_at as string)})`);
  for (const d of docs.data ?? []) {
    const lines = (d.items as { title: string; item_id?: string | null }[]) ?? [];
    // Un documento de este mismo reloj no cuenta (ya se lo ofrecimos)
    if (excludeItemId && lines.some((l) => l.item_id === excludeItemId)) continue;
    const line = lines.find((l) => alertMatches(l.title, watch));
    if (line) add(d.customer_id as string, `${DOC_LABEL[d.kind as string] ?? d.kind} ${d.number}: ${line.title} (${date(d.issue_date as string)})${d.kind === "sourcing" && Number(d.deposit) > 0 ? " · con anticipo" : ""}`);
  }
  for (const c of leads.data ?? []) {
    const line = String(c.interests).split("\n").find((l) => alertMatches(l, watch));
    if (line) add(c.id as string, `📝 En su ficha: «${line.slice(0, 90)}»`);
  }
  if (!hits.size) return [];

  const { data: customers } = await db.from("customers").select("id, name, phone, wa_id, stage").in("id", [...hits.keys()]);
  return ((customers ?? []) as Omit<Hit, "reasons">[]).map((c) => ({ ...c, reasons: hits.get(c.id) ?? [] }));
}

// Aviso por Telegram al equipo (y anotación en la ficha de cada cliente)
export async function notifyInterest(itemId: string, user = "sistema") {
  const db = adminDb();
  const { data: i } = await db.from("inventory_items").select("id, sku, brand, model, reference, asking_price, watch_id").eq("id", itemId).maybeSingle();
  if (!i?.brand) return 0;
  const hits = await interestedFor({ brand: i.brand as string, model: i.model as string | null, reference: i.reference as string | null }, itemId);
  if (!hits.length) return 0;
  const title = [i.brand, i.model, i.reference].filter(Boolean).join(" ");
  const { data: web } = i.watch_id ? await db.from("watches").select("slug").eq("id", i.watch_id).maybeSingle() : { data: null };
  const blocks = hits.slice(0, 10).map((c) => {
    const wa = c.wa_id ?? c.phone?.replace(/\D/g, "");
    return [
      `👤 <b>${h(c.name ?? "Cliente")}</b>${c.phone ? ` · ${h(c.phone)}` : ""}${c.stage === "lost" ? " · <i>estaba perdido</i>" : c.stage === "won" ? " · <i>ya es cliente</i>" : ` · ${h(STAGE_LABEL[c.stage as Stage] ?? c.stage)}`}`,
      ...c.reasons.slice(0, 4).map((r) => `   ${h(r)}`),
      `   Ficha: ${SITE}/admin/leads/${c.id}${wa ? `\n   WhatsApp: https://wa.me/${wa}` : ""}`,
    ].join("\n");
  });
  await notifyAdmins(
    [
      `🔔 <b>Entró una pieza que ${hits.length === 1 ? "un cliente buscaba" : `${hits.length} clientes buscaban`}</b>`,
      `⌚ ${h(i.sku as string)} · ${h(title)}${i.asking_price ? ` · $${Number(i.asking_price).toLocaleString("en-US")}` : ""}`,
      web?.slug ? `${SITE}/es/watches/${web.slug}` : `${SITE}/admin/inventario/${i.id}`,
      "",
      blocks.join("\n\n"),
      hits.length > 10 ? `\n…y ${hits.length - 10} más.` : "",
      "",
      "Escríbeles antes de publicarlo en redes.",
    ].filter((l, k, all) => l !== "" || all[k - 1] !== "").join("\n").slice(0, 4000)
  ).catch(() => {});
  for (const c of hits) await addEvent(c.id, "match", `Entró una pieza que encaja: ${title} (${i.sku})`, { item: i.id, ...(web?.slug && { slug: web.slug }) }, user);
  return hits.length;
}
