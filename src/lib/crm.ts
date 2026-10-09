import "server-only";
import { adminDb } from "./supabase";
import { escapeHtml as h, notifyAdmins } from "./telegram";

// Leads y clientes del CRM. Todos los canales (WhatsApp, formularios de la web, alta manual)
// pasan por aquí, así cada persona tiene una sola ficha con todo su historial.

import { STAGES, STAGE_LABEL, SOURCE_LABEL, INTENT_LABEL, type Stage } from "./crm-labels";
export { STAGES, STAGE_LABEL, SOURCE_LABEL, INTENT_LABEL, type Stage };

export type Customer = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  wa_id: string | null;
  ig_id?: string | null;
  ig_username?: string | null;
  fb_psid?: string | null;
  lang: string | null;
  source: string;
  stage: Stage;
  intent: string | null;
  tags: string[];
  interests: string | null;
  budget: number | null;
  notes: string | null;
  follow_up_at?: string | null;
  follow_up_note?: string | null;
  last_activity_at: string;
  created_at: string;
};

// "+1 (305) 555-0123", "305 555 0123", "13055550123" → "+13055550123" (sin prefijo, se asume EE. UU.)
export function normalizePhone(raw?: string | null) {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 8) return null;
  if (raw.trim().startsWith("+")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return `+${digits}`;
}

const cleanEmail = (raw?: string | null) => {
  const e = raw?.trim().toLowerCase();
  return e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
};

// Las etapas solo avanzan solas (un lead en «negociando» no vuelve a «cita» por pedir otra)
const rank = (s: string) => STAGES.indexOf(s as Stage);

export async function addEvent(customerId: string, type: string, body: string | null, meta: Record<string, unknown> = {}, createdBy = "sistema") {
  await adminDb().from("customer_events").insert({ customer_id: customerId, type, body, meta, created_by: createdBy });
}

type LeadInput = {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  waId?: string | null;
  igId?: string | null; // Instagram (id del usuario en los DM)
  igUsername?: string | null;
  fbPsid?: string | null; // Messenger
  lang?: string | null;
  source: string;
  intent?: string | null;
  interests?: string | null;
  stage?: Stage; // etapa mínima a la que llega con esta acción
  event?: { type: string; body: string; meta?: Record<string, unknown> };
  notify?: boolean; // aviso por Telegram si es un lead nuevo (por defecto, sí)
};

// Crea el lead o actualiza el existente (lo reconoce por WhatsApp, teléfono, correo, Instagram o Messenger)
export async function upsertLead(input: LeadInput) {
  const db = adminDb();
  const phone = normalizePhone(input.phone ?? (input.waId ? `+${input.waId}` : null));
  const waId = input.waId ?? (phone ? phone.slice(1) : null);
  const email = cleanEmail(input.email);
  const igId = input.igId ?? null;
  const fbPsid = input.fbPsid ?? null;

  // Valores entre comillas: un correo con «,» o «(» no rompe el filtro
  const filters = [
    waId && `wa_id.eq."${waId}"`,
    phone && `phone.eq."${phone}"`,
    email && `email.eq."${email.replace(/"/g, "")}"`,
    igId && `ig_id.eq."${igId}"`,
    // Quien comenta (sin id de DM) y luego escribe por DM: se reconoce por su usuario
    input.igUsername && `ig_username.eq."${input.igUsername.replace(/"/g, "")}"`,
    fbPsid && `fb_psid.eq."${fbPsid}"`,
  ].filter(Boolean).join(",");
  const { data: found } = filters
    ? await db.from("customers").select("*").or(filters).order("created_at").limit(1)
    : { data: [] as Customer[] };
  const existing = (found?.[0] as Customer | undefined) ?? null;
  const now = new Date().toISOString();

  let customer: Customer;
  if (existing) {
    const patch: Record<string, unknown> = { last_activity_at: now, updated_at: now };
    if (!existing.name && input.name) patch.name = input.name;
    if (!existing.phone && phone) patch.phone = phone;
    if (!existing.email && email) patch.email = email;
    if (!existing.wa_id && waId) patch.wa_id = waId;
    if (!existing.ig_id && igId) patch.ig_id = igId;
    if (!existing.ig_username && input.igUsername) patch.ig_username = input.igUsername;
    if (!existing.fb_psid && fbPsid) patch.fb_psid = fbPsid;
    if (!existing.lang && input.lang) patch.lang = input.lang;
    if (!existing.intent && input.intent) patch.intent = input.intent;
    if (input.interests) patch.interests = existing.interests ? `${existing.interests}\n${input.interests}` : input.interests;
    if (input.stage && rank(input.stage) > rank(existing.stage) && existing.stage !== "lost") patch.stage = input.stage;
    const { data, error } = await db.from("customers").update(patch).eq("id", existing.id).select("*").single();
    if (error) throw error;
    customer = data as Customer;
    if (patch.stage) await addEvent(customer.id, "stage", `Etapa: ${STAGE_LABEL[patch.stage as Stage]}`, { from: existing.stage, to: patch.stage });
  } else {
    const { data, error } = await db
      .from("customers")
      .insert({
        name: input.name ?? null,
        phone,
        email,
        wa_id: waId,
        // Las columnas de redes solo se escriben si hay dato (así funciona aunque falte su migración)
        ...((igId || input.igUsername) && { ig_id: igId, ig_username: input.igUsername ?? null }),
        ...(fbPsid && { fb_psid: fbPsid }),
        lang: input.lang ?? null,
        source: input.source,
        intent: input.intent ?? null,
        interests: input.interests ?? null,
        stage: input.stage ?? "new",
      })
      .select("*")
      .single();
    if (error) throw error;
    customer = data as Customer;
    await addEvent(customer.id, "lead", `Nuevo lead · ${SOURCE_LABEL[input.source] ?? input.source}`);
    if (input.notify !== false) {
      await notifyAdmins(
        [
          `🆕 <b>Nuevo lead · ${h(SOURCE_LABEL[input.source] ?? input.source)}</b>`,
          `${h(customer.name ?? "Sin nombre")}${input.igUsername ? ` · @${h(input.igUsername)}` : ""}${phone ? ` · ${phone}` : ""}${email ? ` · ${h(email)}` : ""}`,
          input.intent ? `Quiere: ${h(INTENT_LABEL[input.intent] ?? input.intent)}` : "",
          input.interests ? `Busca: ${h(input.interests)}` : "",
          input.event ? h(input.event.body) : "",
        ]
          .filter(Boolean)
          .join("\n")
      ).catch(() => {});
    }
  }

  if (input.event) await addEvent(customer.id, input.event.type, input.event.body, input.event.meta);
  return customer;
}

// Búsqueda de un comprador («avísenme cuando llegue…»)
export async function addWatchAlert(customerId: string, query: string) {
  const q = query.trim();
  if (!q) return;
  await adminDb().from("watch_alerts").insert({ customer_id: customerId, query: q });
  await addEvent(customerId, "alert", `Busca: ${q}`);
}

// Al publicar un reloj: compradores cuya búsqueda encaja. Coincide si la búsqueda contiene la
// referencia, o alguna palabra propia del modelo (Daytona, GMT, Nautilus…) sin nombrar otra marca.
// Los detalles que el cliente añade («Pepsi», «esfera blanca», «2022») no impiden el aviso.
const BRANDS = ["rolex", "audemars", "piguet", "patek", "philippe", "cartier", "richard", "mille", "omega", "vacheron", "constantin", "tudor", "breitling", "hublot", "panerai", "iwc", "jaeger", "lecoultre", "lange"];
const GENERIC = new Set(["oyster", "perpetual", "chronograph", "cosmograph", "automatic", "date", "the", "and", "con", "del", "los", "las", "steel", "acero", "gold", "oro", "white", "black", "blue", "watch", "reloj"]);
const words = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter((w) => w.length > 2);
const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function alertMatches(query: string, watch: { brand: string; model: string; reference: string }) {
  const q = words(query);
  const brand = words(watch.brand);
  if (watch.reference && compact(query).includes(compact(watch.reference))) return true;
  if (q.some((w) => BRANDS.includes(w) && !brand.includes(w))) return false; // pide otra marca
  // Solo la marca («Rolex», «un Patek»): le interesa cualquier pieza de esa marca
  if (q.some((w) => brand.includes(w)) && q.every((w) => brand.includes(w) || GENERIC.has(w) || ["any", "cualquier", "uno", "una", "busco"].includes(w))) return true;
  const modelWords = words(watch.model).filter((w) => !GENERIC.has(w) && !brand.includes(w));
  return modelWords.some((w) => q.includes(w));
}

export async function matchAlerts(watch: { brand: string; model: string; reference: string }) {
  const { data } = await adminDb()
    .from("watch_alerts")
    .select("id, query, customer:customers(id, name, phone, wa_id)")
    .eq("active", true);
  type Row = { id: string; query: string; customer: { id: string; name: string | null; phone: string | null; wa_id: string | null } | null };
  return ((data ?? []) as unknown as Row[]).filter((a) => alertMatches(a.query, watch));
}

// ───────────────────────────── Bajadas de precio ─────────────────────────────
// Clientes a los que les puede interesar un reloj: búsquedas activas que encajan, quienes ya
// recibieron el aviso de esta pieza y leads abiertos cuyo «qué busca» la menciona.
export async function interestedIn(watch: { brand: string; model: string; reference: string; slug?: string | null }) {
  const db = adminDb();
  const [alerts, open, matched] = await Promise.all([
    matchAlerts(watch),
    db.from("customers").select("id, name, phone, wa_id, interests").not("stage", "in", "(won,lost)").not("interests", "is", null),
    watch.slug ? db.from("customer_events").select("customer_id").eq("type", "match").contains("meta", { slug: watch.slug }) : Promise.resolve({ data: [] }),
  ]);
  type C = { id: string; name: string | null; phone: string | null; wa_id: string | null };
  const out = new Map<string, C & { why: string }>();
  for (const a of alerts) if (a.customer) out.set(a.customer.id, { ...a.customer, why: `busca «${a.query}»` });
  for (const c of open.data ?? []) {
    if (out.has(c.id)) continue;
    const line = String(c.interests).split("\n").find((l) => alertMatches(l, watch));
    if (line) out.set(c.id, { ...(c as C), why: `le interesa «${line.slice(0, 80)}»` });
  }
  const ids = [...new Set((matched.data ?? []).map((r) => r.customer_id as string))].filter((id) => !out.has(id));
  if (ids.length) {
    const { data } = await db.from("customers").select("id, name, phone, wa_id").in("id", ids).not("stage", "eq", "won");
    for (const c of data ?? []) out.set(c.id, { ...(c as C), why: "ya se le avisó de esta pieza" });
  }
  return [...out.values()];
}

export async function notifyPriceDrop(
  watch: { brand: string; model: string; reference: string; slug: string },
  from: number,
  to: number,
  siteUrl: string
) {
  const people = await interestedIn(watch);
  if (!people.length) return 0;
  const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
  const lines = people.slice(0, 15).map((c) => {
    const wa = c.wa_id ?? c.phone?.replace(/\D/g, "");
    return [`• <b>${h(c.name ?? "Cliente")}</b>${c.phone ? ` · ${c.phone}` : ""}`, `  ${h(c.why)}`, wa ? `  https://wa.me/${wa}` : ""].filter(Boolean).join("\n");
  });
  await notifyAdmins(
    [
      `📉 <b>Bajó de precio: ${h(watch.brand)} ${h(watch.model)}</b>`,
      `${usd(from)} → <b>${usd(to)}</b> (−${Math.round((1 - to / from) * 100)}%)`,
      `${siteUrl}/es/watches/${watch.slug}`,
      "",
      `${people.length} cliente(s) que pueden estar interesados:`,
      lines.join("\n\n"),
      people.length > 15 ? `…y ${people.length - 15} más en el CRM` : "",
    ].filter(Boolean).join("\n")
  );
  for (const c of people) {
    await addEvent(c.id, "price_drop", `Bajó de precio una pieza que le interesa: ${watch.brand} ${watch.model} (${usd(from)} → ${usd(to)})`, { slug: watch.slug });
  }
  return people.length;
}

// ───────────────────────────── Seguimientos ─────────────────────────────
// Programados (fecha puesta a mano) y automáticos: leads abiertos que se han quedado quietos.
// Días sin actividad tras los que un lead pide seguimiento, según su etapa
export const STALE_AFTER: Partial<Record<Stage, number>> = { new: 2, contacted: 5, qualified: 5, appointment: 3, negotiating: 3 };

export type FollowUp = { id: string; name: string | null; stage: Stage; reason: string; due: string; scheduled: boolean; taskId?: string; wa?: string | null };

export async function followUpsDue(now: number, today: string) {
  const db = adminDb();
  const out: FollowUp[] = [];
  // Si aún no existe la columna (migración pendiente), solo salen los automáticos
  const { data: scheduled } = await db.from("customers").select("id, name, stage, follow_up_at, follow_up_note").lte("follow_up_at", today).order("follow_up_at");
  for (const c of scheduled ?? []) {
    out.push({ id: c.id, name: c.name, stage: c.stage, reason: c.follow_up_note || "Seguimiento programado", due: c.follow_up_at, scheduled: true });
  }
  const { data: open } = await db.from("customers").select("id, name, stage, last_activity_at").in("stage", Object.keys(STALE_AFTER)).order("last_activity_at");
  for (const c of open ?? []) {
    if (out.some((f) => f.id === c.id)) continue;
    const days = Math.floor((now - new Date(c.last_activity_at).getTime()) / 86_400_000);
    const limit = STALE_AFTER[c.stage as Stage]!;
    if (days >= limit) out.push({ id: c.id, name: c.name, stage: c.stage, reason: `${days} días sin actividad en «${STAGE_LABEL[c.stage as Stage]}»`, due: c.last_activity_at, scheduled: false });
  }
  // Postventa (reseña, aniversario, servicio), con el mensaje de WhatsApp preparado
  const { dueTasks, taskMessage, waLink, TASK_LABEL } = await import("./tasks");
  const { getDocSettings } = await import("./documents");
  const tasks = await dueTasks(today);
  if (tasks.length) {
    const reviewUrl = (await getDocSettings()).doc_review_url;
    for (const t of tasks) {
      const c = t.customer;
      out.push({
        id: t.customer_id, name: c?.name ?? null, stage: "won", scheduled: true, due: t.due_date, taskId: t.id,
        reason: `${TASK_LABEL[t.kind] ?? "Seguimiento"}${t.note ? ` · ${t.note.split(" · ")[0]}` : ""}`,
        wa: waLink(c?.wa_id ?? c?.phone ?? null, taskMessage(t, c?.name ?? null, c?.lang ?? null, reviewUrl)),
      });
    }
  }
  return out;
}
