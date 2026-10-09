import { adminEmail } from "@/lib/admin-auth";
import { adminDb } from "@/lib/supabase";
import { daysInStock, margin, type Item } from "@/lib/stock";
import { ACQUISITION, ITEM_STATUS } from "@/lib/stock-labels";

// Exporta el inventario a CSV (se abre en Excel) con las columnas de la plantilla INVENTORY CONTROL
// y las nuevas (estado, cómo entró, gastos, devoluciones…).
export async function GET() {
  if (!(await adminEmail())) return new Response("Unauthorized", { status: 401 });
  const { data } = await adminDb().from("inventory_items").select("*").order("purchase_date", { ascending: true, nullsFirst: true });
  const now = Date.now();

  const columns: [string, (i: Item) => unknown][] = [
    ["SKU", (i) => i.sku],
    ["Status", (i) => ITEM_STATUS[i.status]],
    ["Acquisition", (i) => ACQUISITION[i.acquisition]],
    ["Purchase Date", (i) => i.purchase_date],
    ["Sale Date", (i) => i.sale_date],
    ["Days In Stock", (i) => daysInStock(i, now)],
    ["Brand", (i) => i.brand],
    ["Model", (i) => i.model],
    ["Contact Name", (i) => i.supplier_name],
    ["Company Name", (i) => i.supplier_company],
    ["Location", (i) => i.supplier_location],
    ["Client", (i) => i.buyer_name],
    ["Description", (i) => i.description],
    ["Serial #", (i) => i.serial],
    ["Ref #", (i) => i.reference],
    ["Dated", (i) => i.papers_date],
    ["Links #", (i) => i.links],
    ["Condition", (i) => i.condition],
    ["Comes with", (i) => i.comes_with],
    ["Cost", (i) => i.cost],
    ["Extra Costs", (i) => i.extra_costs],
    ["Asking Price", (i) => i.asking_price],
    ["Sale", (i) => i.sale_price],
    ["Margin $", (i) => margin(i)?.amount],
    ["Margin % (on sale)", (i) => { const m = margin(i)?.onSale; return m == null ? null : Math.round(m * 1000) / 10; }],
    ["Payment", (i) => i.payment_method],
    ["Owner Paid", (i) => i.owner_paid_at],
    ["Memo Due", (i) => i.memo_due],
    ["Return Date", (i) => i.return_date],
    ["Return Reason", (i) => i.return_reason],
    ["Internal Notes", (i) => i.notes],
  ];

  const cell = (v: unknown) => {
    if (v == null) return "";
    const s = String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [columns.map(([h]) => h).join(","), ...((data ?? []) as Item[]).map((i) => columns.map(([, f]) => cell(f(i))).join(","))].join("\r\n");
  const day = new Date().toISOString().slice(0, 10);
  // BOM para que Excel lea bien acentos y símbolos
  return new Response("﻿" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="inventario-the-heure-society-${day}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
