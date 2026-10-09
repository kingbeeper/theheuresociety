import "server-only";
import { adminDb } from "./supabase";

// Ubicación de los relojes y conteo de inventario. Un reloj en memo o en el relojero no está en
// la tienda: se lista aparte y no cuenta como «falta».

export type Count = { id: string; started_at: string; finished_at: string | null; started_by: string | null; expected: string[]; found: string[] };

export async function openCount() {
  const { data, error } = await adminDb().from("inventory_counts").select("*").is("finished_at", null).order("started_at", { ascending: false }).limit(1).maybeSingle();
  return error ? null : (data as Count | null);
}

// Relojes que no están físicamente: en un memo abierto o en el relojero
export async function awayItems() {
  const db = adminDb();
  const [memos, services] = await Promise.all([
    db.from("documents").select("number, client_name, items").eq("kind", "memo").eq("status", "sent"),
    db.from("item_services").select("item_id, provider").is("returned_at", null),
  ]);
  const away = new Map<string, string>();
  for (const m of memos.data ?? []) for (const l of (m.items as { item_id?: string }[]) ?? []) if (l.item_id) away.set(l.item_id, `En memo ${m.number}${m.client_name ? ` (${m.client_name})` : ""}`);
  for (const s of services.data ?? []) away.set(s.item_id as string, `En el relojero (${s.provider})`);
  return away;
}

export async function startCount(user: string) {
  const db = adminDb();
  const away = await awayItems();
  const { data } = await db.from("inventory_items").select("id").in("status", ["in_stock", "reserved"]);
  const expected = (data ?? []).map((i) => i.id as string).filter((id) => !away.has(id));
  const { data: count, error } = await db.from("inventory_counts").insert({ started_by: user, expected }).select("*").single();
  if (error) throw error;
  return count as Count;
}

export async function markCounted(countId: string, itemId: string, found: boolean) {
  const db = adminDb();
  const { data } = await db.from("inventory_counts").select("found").eq("id", countId).single();
  const set = new Set((data?.found as string[]) ?? []);
  if (found) set.add(itemId);
  else set.delete(itemId);
  await db.from("inventory_counts").update({ found: [...set] }).eq("id", countId);
  if (found) await db.from("inventory_items").update({ last_counted_at: new Date().toISOString() }).eq("id", itemId);
}

export async function finishCount(countId: string) {
  const db = adminDb();
  const { data } = await db.from("inventory_counts").update({ finished_at: new Date().toISOString() }).eq("id", countId).select("*").single();
  const c = data as Count;
  const missing = c.expected.filter((id) => !c.found.includes(id));
  return { count: c, missing };
}
