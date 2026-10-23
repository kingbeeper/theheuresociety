import "server-only";
import { adminDb } from "./supabase";
import { balanceDue, paidSoFar, type DocLine } from "./doc-labels";

// Cuenta corriente con cada dealer: lo que nos debe, lo que le debemos, y las piezas de uno en manos del otro
// (memos). Los importes que le debemos salen del costo de las piezas: solo se muestran con el permiso de costos.

export type DealerAccount = {
  owesUs: { docId: string; number: string; kind: "invoice" | "proforma"; amount: number; due: string | null }[];
  weOwe: { itemId: string; sku: string; title: string; amount: number }[]; // piezas suyas ya vendidas, sin pagarle
  memoFromHim: { itemId: string; sku: string; title: string; due: string | null; days: number | null }[]; // piezas suyas con nosotros (memo)
  memoToHim: { docId: string; number: string; title: string; due: string | null; days: number | null }[]; // piezas nuestras con él (memo)
  boughtFrom: { n: number; total: number };
  soldTo: { n: number; total: number };
};

const empty = (): DealerAccount => ({ owesUs: [], weOwe: [], memoFromHim: [], memoToHim: [], boughtFrom: { n: 0, total: 0 }, soldTo: { n: 0, total: 0 } });
const round = (n: number) => Math.round(n * 100) / 100;
// Días de retraso (positivo = vencido hace N días; negativo = faltan N días)
const lateBy = (due: string | null, today: string) => (due ? Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${due}T12:00:00Z`)) / 86_400_000) : null);
const titleOf = (i: { brand: string | null; model: string | null; reference: string | null }) => [i.brand, i.model, i.reference].filter(Boolean).join(" ");

export async function dealerAccounts(ids: string[], today: string) {
  const out = new Map<string, DealerAccount>(ids.map((id) => [id, empty()]));
  if (!ids.length) return out;
  const db = adminDb();
  const [{ data: docs }, { data: items }] = await Promise.all([
    db.from("documents").select("id, kind, number, status, customer_id, total, deposit, payments, due_date, items").in("customer_id", ids).in("kind", ["invoice", "proforma", "memo"]).eq("status", "sent"),
    db.from("inventory_items").select("id, sku, brand, model, reference, status, acquisition, cost, sale_price, supplier_customer_id, buyer_customer_id, memo_due, owner_paid_at").or(`supplier_customer_id.in.(${ids.join(",")}),buyer_customer_id.in.(${ids.join(",")})`),
  ]);
  for (const d of docs ?? []) {
    const a = out.get(d.customer_id as string);
    if (!a) continue;
    if (d.kind === "invoice") {
      const amount = balanceDue(d as { total: number; deposit?: number });
      if (amount > 0) a.owesUs.push({ docId: d.id as string, number: d.number as string, kind: "invoice", amount, due: d.due_date as string | null });
    } else if (d.kind === "proforma") {
      const amount = round(Math.max(0, Number(d.total) - paidSoFar(d as { payments?: { amount: number }[] } as never)));
      if (amount > 0) a.owesUs.push({ docId: d.id as string, number: d.number as string, kind: "proforma", amount, due: d.due_date as string | null });
    } else {
      const line = ((d.items ?? []) as DocLine[])[0];
      a.memoToHim.push({ docId: d.id as string, number: d.number as string, title: line?.title ?? "—", due: d.due_date as string | null, days: lateBy(d.due_date as string | null, today) });
    }
  }
  for (const i of items ?? []) {
    const title = titleOf(i as never);
    const supplier = out.get(i.supplier_customer_id as string);
    if (supplier) {
      if (i.acquisition === "purchase" || i.acquisition === "trade") {
        supplier.boughtFrom.n++;
        supplier.boughtFrom.total += Number(i.cost ?? 0);
      }
      // Pieza suya: vendida y sin pagarle, o todavía con nosotros en memo
      if ((i.acquisition === "consignment" || i.acquisition === "memo") && i.status === "sold" && !i.owner_paid_at) supplier.weOwe.push({ itemId: i.id as string, sku: i.sku as string, title, amount: Number(i.cost ?? 0) });
      if (i.acquisition === "memo" && (i.status === "in_stock" || i.status === "reserved")) supplier.memoFromHim.push({ itemId: i.id as string, sku: i.sku as string, title, due: i.memo_due as string | null, days: lateBy(i.memo_due as string | null, today) });
    }
    const buyer = out.get(i.buyer_customer_id as string);
    if (buyer && i.status === "sold") {
      buyer.soldTo.n++;
      buyer.soldTo.total += Number(i.sale_price ?? 0);
    }
  }
  return out;
}

export const sum = (xs: { amount: number }[]) => round(xs.reduce((a, x) => a + x.amount, 0));
// Memos vencidos o que vencen en N días (de cualquiera de los dos lados)
export const memosDueSoon = (a: DealerAccount, inDays = 2) => [...a.memoFromHim, ...a.memoToHim].filter((m) => m.days != null && m.days >= -inDays);

// Mensajes (en inglés, como se habla en el gremio) para el dealer
const first = (name: string | null) => (name ? ` ${name.split(" ")[0]}` : "");
const when = (days: number | null, due: string | null) =>
  days == null || !due ? "" : days > 0 ? ` (it was due ${due}, ${days} day${days === 1 ? "" : "s"} ago)` : days === 0 ? " (due today)" : ` (due ${due})`;
export const memoToHimMessage = (name: string | null, title: string, days: number | null, due: string | null) =>
  `Hi${first(name)}, The Heure Society here. A quick reminder about the ${title} we have with you on memo${when(days, due)}. Could you please return it or let us know if you'd like to keep it and settle the invoice? Thanks!`;
export const memoFromHimMessage = (name: string | null, title: string, days: number | null, due: string | null) =>
  `Hi${first(name)}, The Heure Society here. About the ${title} you have on memo with us${when(days, due)}: we'll either return it or settle it with you — would you like it back, or can we extend it a few more days? Thanks!`;
export const owesUsMessage = (name: string | null, number: string, amount: number) =>
  `Hi${first(name)}, The Heure Society here. A quick reminder that invoice ${number} ($${Math.round(amount).toLocaleString("en-US")}) is still open. Could you please send the payment when you can? Thanks!`;
