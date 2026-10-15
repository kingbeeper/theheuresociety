import "server-only";
import { adminDb } from "./supabase";
import { addEvent, type Customer } from "./crm";
import { STAGES, type Stage } from "./crm-labels";

// Clientes duplicados (el mismo entra por WhatsApp, Instagram y la web con datos distintos):
// detectarlos y fusionarlos en una sola ficha, con todo su historial y sus documentos.

const digits = (p: string | null | undefined) => (p ?? "").replace(/\D/g, "").slice(-10);
const plain = (s: string | null | undefined) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();

type Lite = Pick<Customer, "id" | "name" | "phone" | "email" | "wa_id" | "stage" | "source" | "last_activity_at" | "created_at">;

// Grupos de posibles duplicados: mismo teléfono, mismo correo o mismo nombre completo (2+ palabras)
export async function duplicateGroups() {
  const { data } = await adminDb().from("customers").select("id, name, phone, email, wa_id, stage, source, last_activity_at, created_at").limit(5000);
  const list = (data ?? []) as Lite[];
  const parent = new Map(list.map((c) => [c.id, c.id]));
  const find = (id: string): string => (parent.get(id) === id ? id : find(parent.get(id)!));
  const union = (a: string, b: string) => parent.set(find(a), find(b));
  const by = new Map<string, string>();
  const link = (key: string, id: string) => {
    if (!key) return;
    const prev = by.get(key);
    if (prev) union(prev, id);
    else by.set(key, id);
  };
  for (const c of list) {
    const ph = digits(c.phone) || digits(c.wa_id);
    if (ph.length >= 10) link(`p:${ph}`, c.id);
    if (c.email) link(`e:${c.email.toLowerCase()}`, c.id);
    const n = plain(c.name);
    if (n.split(" ").length >= 2) link(`n:${n}`, c.id);
  }
  const groups = new Map<string, Lite[]>();
  for (const c of list) groups.set(find(c.id), [...(groups.get(find(c.id)) ?? []), c]);
  return [...groups.values()].filter((g) => g.length > 1).map((g) => g.sort((a, b) => a.created_at.localeCompare(b.created_at)));
}

export async function duplicatesOf(id: string) {
  return (await duplicateGroups()).find((g) => g.some((c) => c.id === id))?.filter((c) => c.id !== id) ?? [];
}

// Tablas que apuntan a un cliente (columna → se pasan a la ficha que se queda)
const REFS: [string, string][] = [
  ["customer_events", "customer_id"], ["watch_alerts", "customer_id"], ["appointments", "customer_id"], ["sell_requests", "customer_id"],
  ["wa_contacts", "customer_id"], ["social_contacts", "customer_id"], ["social_comments", "customer_id"], ["documents", "customer_id"],
  ["customer_tasks", "customer_id"], ["staff_tasks", "customer_id"], ["payments", "customer_id"], ["appointment_followups", "customer_id"],
  ["reminders", "customer_id"], ["dealer_requests", "dealer_id"], ["inventory_items", "buyer_customer_id"], ["inventory_items", "supplier_customer_id"],
];

// Fusiona `dropId` en `keepId`: todo lo de la ficha que se va pasa a la que se queda; los datos que le
// falten a esta se completan con los de la otra; la que se va se borra.
export async function mergeCustomers(keepId: string, dropId: string, user: string) {
  if (keepId === dropId) return;
  const db = adminDb();
  const { data: rows } = await db.from("customers").select("*").in("id", [keepId, dropId]);
  const keep = rows?.find((r) => r.id === keepId) as Customer | undefined;
  const drop = rows?.find((r) => r.id === dropId) as (Customer & Record<string, unknown>) | undefined;
  if (!keep || !drop) throw new Error("No encontré los dos clientes.");

  for (const [table, col] of REFS) {
    const { error } = await db.from(table).update({ [col]: keepId }).eq(col, dropId);
    // Tareas de postventa repetidas (única por cliente, reloj y tipo): se quedan las de la ficha principal
    if (error && table === "customer_tasks") await db.from(table).delete().eq(col, dropId);
  }

  // Datos: lo que le falta a la ficha que se queda; etiquetas e intereses se suman; la etapa más avanzada
  const patch: Record<string, unknown> = { last_activity_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  const fill = ["name", "phone", "email", "wa_id", "ig_id", "ig_username", "fb_psid", "lang", "intent", "budget", "follow_up_at", "follow_up_note"] as const;
  const unique = new Set(["phone", "email", "wa_id"]);
  const later: Record<string, unknown> = {};
  for (const k of fill) {
    const kv = (keep as Record<string, unknown>)[k];
    const dv = drop[k];
    if ((kv == null || kv === "") && dv != null && dv !== "") (unique.has(k) ? later : patch)[k] = dv;
  }
  patch.tags = [...new Set([...(keep.tags ?? []), ...(drop.tags ?? [])])];
  if (drop.interests) patch.interests = keep.interests ? `${keep.interests}\n${drop.interests}` : drop.interests;
  if (drop.notes) patch.notes = keep.notes ? `${keep.notes}\n${drop.notes}` : drop.notes;
  const rank = (s: Stage) => (s === "lost" ? -1 : STAGES.indexOf(s));
  if (rank(drop.stage) > rank(keep.stage)) patch.stage = drop.stage;

  await db.from("customers").update(patch).eq("id", keepId);
  // Teléfono, correo y WhatsApp son únicos: se pasan después de borrar la ficha duplicada
  const { error: delError } = await db.from("customers").delete().eq("id", dropId);
  if (delError) throw new Error(`No se pudo quitar la ficha duplicada: ${delError.message}`);
  if (Object.keys(later).length) await db.from("customers").update(later).eq("id", keepId);
  await addEvent(keepId, "merge", `Fusionado con la ficha de ${drop.name ?? drop.phone ?? drop.email ?? "otro cliente"} (${drop.source})`, { from: dropId }, user);
}
