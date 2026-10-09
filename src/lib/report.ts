import "server-only";
import { adminDb } from "./supabase";
import { margin, totalCost, type Item } from "./stock";
import { ACQUISITION, isOwnerStock } from "./stock-labels";
import { docTotals, type Doc } from "./doc-labels";

// Informe mensual para el contador: ventas, compras, pagos a dueños, gastos del relojero e
// impuesto de ventas cobrado (de las facturas pagadas en el mes).

export type MonthlyReport = Awaited<ReturnType<typeof monthlyReport>>;

const monthRange = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  const start = `${month}-01`;
  const end = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10); // primer día del mes siguiente
  return { start, end };
};

export async function monthlyReport(month: string) {
  const { start, end } = monthRange(month);
  const db = adminDb();
  const [sold, entered, ownerPaid, invoices, services] = await Promise.all([
    db.from("inventory_items").select("*").eq("status", "sold").gte("sale_date", start).lt("sale_date", end).order("sale_date"),
    db.from("inventory_items").select("*").gte("purchase_date", start).lt("purchase_date", end).order("purchase_date"),
    db.from("inventory_items").select("*").gte("owner_paid_at", start).lt("owner_paid_at", end).order("owner_paid_at"),
    db.from("documents").select("*").eq("kind", "invoice").eq("status", "paid").gte("paid_at", start).lt("paid_at", end).order("paid_at"),
    db.from("item_services").select("*, item:inventory_items(sku, brand, model)").gte("returned_at", start).lt("returned_at", end).order("returned_at"),
  ]);

  const sales = ((sold.data ?? []) as Item[]).map((i) => {
    const m = margin(i);
    return {
      date: i.sale_date!, sku: i.sku, watch: [i.brand, i.model, i.reference].filter(Boolean).join(" "), serial: i.serial,
      acquisition: ACQUISITION[i.acquisition], buyer: i.buyer_name, payment: i.payment_method,
      price: Number(i.sale_price ?? 0), cost: Number(i.cost ?? 0), extra: Number(i.extra_costs ?? 0), profit: m?.amount ?? null,
    };
  });
  const purchases = ((entered.data ?? []) as Item[]).map((i) => ({
    date: i.purchase_date!, sku: i.sku, watch: [i.brand, i.model, i.reference].filter(Boolean).join(" "), serial: i.serial,
    acquisition: ACQUISITION[i.acquisition], supplier: [i.supplier_name, i.supplier_company].filter(Boolean).join(" · ") || null,
    // En consignación y memo no hay desembolso al entrar: se paga al dueño al vender
    cost: isOwnerStock(i.acquisition) ? 0 : Number(i.cost ?? 0), owner: isOwnerStock(i.acquisition),
  }));
  const owners = ((ownerPaid.data ?? []) as Item[]).map((i) => ({
    date: i.owner_paid_at!, sku: i.sku, watch: [i.brand, i.model].filter(Boolean).join(" "), owner: i.supplier_name, amount: Number(i.cost ?? 0),
  }));
  const taxes = ((invoices.data ?? []) as Doc[]).map((d) => {
    const t = docTotals(d);
    return { date: d.paid_at!, number: d.number, client: d.client_name, taxable: t.subtotal - t.discount, rate: Number(d.tax_rate), tax: t.tax, total: t.total };
  });
  type ServiceRow = { returned_at: string; provider: string; work: string | null; cost: number | null; item: { sku: string; brand: string; model: string | null } | null };
  const repairs = ((services.data ?? []) as unknown as ServiceRow[]).map((s) => ({
    date: s.returned_at, sku: s.item?.sku ?? "", watch: [s.item?.brand, s.item?.model].filter(Boolean).join(" "), provider: s.provider, work: s.work, cost: Number(s.cost ?? 0),
  }));

  const sum = <T,>(rows: T[], f: (r: T) => number | null) => rows.reduce((a, r) => a + (f(r) ?? 0), 0);
  return {
    month,
    sales,
    purchases,
    owners,
    taxes,
    repairs,
    totals: {
      revenue: sum(sales, (s) => s.price),
      cogs: sum((sold.data ?? []) as Item[], (i) => totalCost(i)),
      profit: sum(sales, (s) => s.profit),
      bought: sum(purchases, (p) => p.cost),
      ownerPaid: sum(owners, (o) => o.amount),
      taxCollected: sum(taxes, (t) => t.tax),
      taxableSales: sum(taxes, (t) => (t.tax > 0 ? t.taxable : 0)),
      exemptSales: sum(taxes, (t) => (t.tax > 0 ? 0 : t.taxable)),
      repairs: sum(repairs, (r) => r.cost),
    },
  };
}
