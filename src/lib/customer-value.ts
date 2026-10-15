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
  let paid = db.from("documents").select("customer_id, items, paid_at, issue_date").eq("kind", "invoice").eq("status", "paid").not("customer_id", "is", null);
  if (ids) paid = paid.in("customer_id", ids);
  const [{ data: sales }, { data: supplies }, { data: invoices }] = await Promise.all([bought, supplied, paid]);
  // Relojes de esas facturas que el inventario ya tiene a nombre de alguien (esos cuentan por el inventario)
  type Line = { item_id?: string | null; qty?: number; price?: number };
  const lineIds = [...new Set((invoices ?? []).flatMap((d) => ((d.items ?? []) as Line[]).map((l) => l.item_id).filter(Boolean) as string[]))];
  const { data: linked } = lineIds.length ? await db.from("inventory_items").select("id, buyer_customer_id, sale_price").in("id", lineIds) : { data: [] };
  const withBuyer = new Set((linked ?? []).filter((i) => i.buyer_customer_id).map((i) => i.id as string));
  const salePrice = new Map((linked ?? []).map((i) => [i.id as string, i.sale_price as number | null]));
  const out = new Map<string, CustomerValue>();
  const get = (id: string) => out.get(id) ?? out.set(id, { spent: 0, purchases: 0, lastPurchase: null, supplied: 0, vip: false }).get(id)!;
  for (const s of sales ?? []) {
    const v = get(s.buyer_customer_id as string);
    v.spent += Number(s.sale_price ?? 0);
    v.purchases++;
    if (s.sale_date && (!v.lastPurchase || s.sale_date > v.lastPurchase)) v.lastPurchase = s.sale_date as string;
  }
  for (const d of invoices ?? []) {
    for (const l of (d.items ?? []) as Line[]) {
      if (l.item_id && withBuyer.has(l.item_id)) continue;
      const v = get(d.customer_id as string);
      v.spent += Number((l.item_id && salePrice.get(l.item_id)) ?? (l.qty ?? 1) * (l.price ?? 0));
      v.purchases++;
      const day = (d.paid_at ?? d.issue_date) as string | null;
      if (day && (!v.lastPurchase || day > v.lastPurchase)) v.lastPurchase = day;
    }
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
