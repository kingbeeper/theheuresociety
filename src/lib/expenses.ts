import "server-only";
import { adminDb } from "./supabase";

// Gastos generales del negocio (no de un reloj concreto): renta, marketing, envíos… Restados a la
// ganancia de las ventas dan la ganancia real del mes.

export const EXPENSE_CATEGORY: Record<string, string> = {
  rent: "🏢 Renta y oficina",
  marketing: "📣 Marketing y anuncios",
  shipping: "📦 Envíos y seguros",
  commissions: "🤝 Comisiones",
  software: "💻 Software y servicios",
  travel: "✈️ Viajes y ferias",
  payroll: "👥 Sueldos",
  other: "🧾 Otros",
};

export type Expense = { id: string; spent_on: string; category: string; amount: number; note: string | null; created_by: string | null };

export async function expensesBetween(from: string, to?: string) {
  let q = adminDb().from("business_expenses").select("*").gte("spent_on", from).order("spent_on", { ascending: false });
  if (to) q = q.lt("spent_on", to);
  const { data } = await q;
  return ((data ?? []) as Expense[]).map((e) => ({ ...e, amount: Number(e.amount) }));
}

export async function addExpense(e: { spent_on: string; category: string; amount: number; note: string | null }, user: string) {
  const category = EXPENSE_CATEGORY[e.category] ? e.category : "other";
  const { error } = await adminDb().from("business_expenses").insert({ ...e, category, amount: Math.round(e.amount * 100) / 100, created_by: user });
  if (error) throw error;
}

export const sumExpenses = (list: { amount: number }[]) => Math.round(list.reduce((a, e) => a + e.amount, 0) * 100) / 100;
