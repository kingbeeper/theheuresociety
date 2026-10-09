import "server-only";
import { adminDb } from "./supabase";
import { logItem } from "./stock";

// Relojes en el relojero (servicio, pulido, reparación). Al volver, el costo se suma a los
// gastos del reloj y por tanto a su margen.

export type Service = {
  id: string;
  item_id: string;
  provider: string;
  work: string | null;
  sent_at: string;
  expected_at: string | null;
  returned_at: string | null;
  cost: number | null;
  notes: string | null;
};

export async function itemServices(itemId: string) {
  const { data } = await adminDb().from("item_services").select("*").eq("item_id", itemId).order("sent_at", { ascending: false });
  return (data ?? []) as Service[];
}

// Servicios abiertos de todo el inventario (para la lista, el resumen diario y Telegram)
export async function openServices() {
  const { data, error } = await adminDb().from("item_services").select("*, item:inventory_items(id, sku, brand, model)").is("returned_at", null).order("sent_at");
  if (error) return []; // migración pendiente
  return (data ?? []) as (Service & { item: { id: string; sku: string; brand: string; model: string | null } | null })[];
}

export async function providers() {
  const { data } = await adminDb().from("item_services").select("provider").order("created_at", { ascending: false }).limit(200);
  return [...new Set((data ?? []).map((r) => r.provider as string))];
}

export async function sendToService(itemId: string, f: { provider: string; work: string | null; expected_at: string | null }, user: string) {
  const { error } = await adminDb().from("item_services").insert({ item_id: itemId, provider: f.provider, work: f.work, expected_at: f.expected_at, created_by: user });
  if (error) throw error;
  await logItem(itemId, "service", `Enviado al relojero: ${f.provider}${f.work ? ` · ${f.work}` : ""}${f.expected_at ? ` · vuelve ~${f.expected_at}` : ""}`, user);
}

export async function returnFromService(serviceId: string, cost: number | null, notes: string | null, user: string) {
  const db = adminDb();
  const { data: s } = await db.from("item_services").update({ returned_at: new Date().toISOString().slice(0, 10), cost, notes }).eq("id", serviceId).is("returned_at", null).select("*").maybeSingle();
  if (!s) return;
  if (cost) {
    const { data: item } = await db.from("inventory_items").select("extra_costs").eq("id", s.item_id).single();
    await db.from("inventory_items").update({ extra_costs: Number(item?.extra_costs ?? 0) + cost, updated_at: new Date().toISOString() }).eq("id", s.item_id);
  }
  await logItem(s.item_id, "service", `Vuelve del relojero (${s.provider})${cost ? ` · costo $${cost.toLocaleString("en-US")} sumado a gastos` : ""}${notes ? ` · ${notes}` : ""}`, user);
}
