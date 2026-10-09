import "server-only";
import { adminDb } from "./supabase";

// Valor de cada cliente según el inventario: lo que nos compró y lo que nos vendió o consignó.
// VIP: $50.000 o más en compras, o 3 compras o más.

export type CustomerValue = { spent: number; purchases: number; lastPurchase: string | null; supplied: number; vip: boolean };

const VIP_SPENT = 50_000;
const VIP_COUNT = 3;

export async function customerValues(ids?: string[]) {
  const db = adminDb();
  let bought = db.from("inventory_items").select("buyer_customer_id, sale_price, sale_date").eq("status", "sold").not("buyer_customer_id", "is", null);
  let supplied = db.from("inventory_items").select("supplier_customer_id").not("supplier_customer_id", "is", null);
  if (ids) {
    if (!ids.length) return new Map<string, CustomerValue>();
    bought = bought.in("buyer_customer_id", ids);
    supplied = supplied.in("supplier_customer_id", ids);
  }
  const [{ data: sales }, { data: supplies }] = await Promise.all([bought, supplied]);
  const out = new Map<string, CustomerValue>();
  const get = (id: string) => out.get(id) ?? out.set(id, { spent: 0, purchases: 0, lastPurchase: null, supplied: 0, vip: false }).get(id)!;
  for (const s of sales ?? []) {
    const v = get(s.buyer_customer_id as string);
    v.spent += Number(s.sale_price ?? 0);
    v.purchases++;
    if (s.sale_date && (!v.lastPurchase || s.sale_date > v.lastPurchase)) v.lastPurchase = s.sale_date as string;
  }
  for (const s of supplies ?? []) get(s.supplier_customer_id as string).supplied++;
  for (const v of out.values()) v.vip = v.spent >= VIP_SPENT || v.purchases >= VIP_COUNT;
  return out;
}

// Mejores clientes por compras (para el panel)
export async function topCustomers(limit = 8) {
  const values = await customerValues();
  const ranked = [...values.entries()].filter(([, v]) => v.purchases > 0).sort((a, b) => b[1].spent - a[1].spent).slice(0, limit);
  if (!ranked.length) return [];
  const { data } = await adminDb().from("customers").select("id, name").in("id", ranked.map(([id]) => id));
  const names = new Map((data ?? []).map((c) => [c.id as string, c.name as string | null]));
  return ranked.map(([id, v]) => ({ id, name: names.get(id) ?? null, ...v }));
}
