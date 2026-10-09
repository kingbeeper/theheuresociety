import "server-only";
import { revalidateTag } from "next/cache";
import { adminDb } from "./supabase";
import { INVENTORY_TAG } from "./inventory";
import { addEvent } from "./crm";
import { isOwnerStock } from "./stock-labels";

// Inventario privado (stock, ventas, devoluciones). Distinto de `watches`, que es la ficha pública
// de la web: un reloj del inventario puede estar enlazado a su ficha (watch_id).

export type Item = {
  id: string;
  sku: string;
  status: "in_stock" | "reserved" | "sold" | "returned";
  acquisition: "purchase" | "trade" | "consignment" | "memo";
  brand: string;
  model: string | null;
  reference: string | null;
  serial: string | null;
  papers_date: string | null;
  links: string | null;
  condition: string | null;
  comes_with: string | null;
  description: string | null;
  supplier_customer_id: string | null;
  supplier_name: string | null;
  supplier_company: string | null;
  supplier_location: string | null;
  purchase_date: string | null;
  cost: number | null;
  extra_costs: number;
  asking_price: number | null;
  memo_due: string | null;
  trade_for_item_id: string | null;
  watch_id: string | null;
  sale_date: string | null;
  sale_price: number | null;
  buyer_customer_id: string | null;
  buyer_name: string | null;
  payment_method: string | null;
  owner_paid_at: string | null;
  return_date: string | null;
  return_reason: string | null;
  notes: string | null;
  created_at: string;
};

const DAY = 86_400_000;
const num = (v: unknown) => (v == null || v === "" ? null : Number(v));

export const totalCost = (i: Item) => (num(i.cost) ?? 0) + (num(i.extra_costs) ?? 0);

// Ganancia: venta − costo − gastos. En consignación/memo el «costo» es lo que se paga al dueño.
export function margin(i: Item) {
  const sale = num(i.sale_price);
  if (sale == null || num(i.cost) == null) return null;
  const amount = sale - totalCost(i);
  return { amount, onSale: sale ? amount / sale : null, onCost: totalCost(i) ? amount / totalCost(i) : null };
}

// Días en stock: hasta la venta o devolución, o hasta hoy si sigue disponible
export function daysInStock(i: Item, now: number) {
  if (!i.purchase_date) return null;
  const end = i.sale_date ?? i.return_date;
  return Math.max(0, Math.round(((end ? new Date(end).getTime() : now) - new Date(i.purchase_date).getTime()) / DAY));
}

export async function logItem(itemId: string, type: string, body: string, createdBy = "sistema", meta: Record<string, unknown> = {}) {
  await adminDb().from("inventory_events").insert({ item_id: itemId, type, body, meta, created_by: createdBy });
}

// La ficha de la web sigue al inventario (vendido → sale del estuche; devuelto → se retira)
export async function syncWebStatus(watchId: string | null, status: "available" | "reserved" | "sold" | "draft") {
  if (!watchId) return;
  await adminDb().from("watches").update({ status, updated_at: new Date().toISOString() }).eq("id", watchId);
  revalidateTag(INVENTORY_TAG, { expire: 0 });
}

// El comprador queda como cliente «ganado» con la compra en su historial
export async function recordPurchase(customerId: string | null, item: Item, user: string) {
  if (!customerId) return;
  await adminDb().from("customers").update({ stage: "won", last_activity_at: new Date().toISOString() }).eq("id", customerId);
  await addEvent(customerId, "purchase", `Compró ${item.brand} ${item.model ?? ""} ${item.reference ?? ""}`.replace(/\s+/g, " ").trim() + (item.sale_price ? ` por $${Number(item.sale_price).toLocaleString("en-US")}` : ""), { item: item.id, sku: item.sku }, user);
}

// Resumen para el panel de inventario
export function summarize(items: Item[], now: number) {
  const monthStart = new Date(new Date(now).getFullYear(), new Date(now).getMonth(), 1).getTime();
  const available = items.filter((i) => i.status === "in_stock" || i.status === "reserved");
  const owned = available.filter((i) => !isOwnerStock(i.acquisition));
  const consigned = available.filter((i) => isOwnerStock(i.acquisition));
  const sold = items.filter((i) => i.status === "sold" && i.sale_date);
  const soldMonth = sold.filter((i) => new Date(i.sale_date!).getTime() >= monthStart);
  const recent = sold.filter((i) => new Date(i.sale_date!).getTime() >= now - 90 * DAY);
  const margins = recent.map(margin).filter((m): m is NonNullable<ReturnType<typeof margin>> => m != null && m.onSale != null);
  const days = recent.map((i) => daysInStock(i, now)).filter((d): d is number => d != null);
  const owed = sold.filter((i) => isOwnerStock(i.acquisition) && !i.owner_paid_at);

  return {
    inStock: available.length,
    capital: owned.reduce((a, i) => a + totalCost(i), 0),
    stockValue: available.reduce((a, i) => a + (num(i.asking_price) ?? 0), 0),
    consignedCount: consigned.length,
    salesMonth: soldMonth.reduce((a, i) => a + (num(i.sale_price) ?? 0), 0),
    profitMonth: soldMonth.reduce((a, i) => a + (margin(i)?.amount ?? 0), 0),
    soldMonthCount: soldMonth.length,
    avgMargin: margins.length ? margins.reduce((a, m) => a + (m.onSale ?? 0), 0) / margins.length : null,
    avgDays: days.length ? Math.round(days.reduce((a, d) => a + d, 0) / days.length) : null,
    aged: available.filter((i) => (daysInStock(i, now) ?? 0) > 90),
    owed,
    owedAmount: owed.reduce((a, i) => a + (num(i.cost) ?? 0), 0),
    memoDue: available.filter((i) => i.acquisition === "memo" && i.memo_due && new Date(i.memo_due).getTime() <= now + 7 * DAY),
    missingCost: available.filter((i) => num(i.cost) == null),
  };
}
