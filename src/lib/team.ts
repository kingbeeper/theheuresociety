import "server-only";
import { adminDb } from "./supabase";
import { margin, type Item } from "./stock";

// Equipo del CRM: superadministradores y usuarios, su Telegram y sus comisiones.

const owners = () => (process.env.CRM_ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
export const isEmail = (s: string | null | undefined) => Boolean(s && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));

export type Member = { email: string; name: string | null; owner: boolean; rate: number; base: "profit" | "sale"; telegram_id: string | null };

export async function team(): Promise<Member[]> {
  const { data } = await adminDb().from("crm_users").select("email, name, active, commission_rate, commission_base, telegram_id").eq("active", true).order("created_at");
  const users = (data ?? []).map((u) => ({
    email: u.email as string, name: u.name as string | null, owner: false,
    rate: Number(u.commission_rate ?? 0), base: (u.commission_base === "sale" ? "sale" : "profit") as Member["base"], telegram_id: (u.telegram_id as string | null) ?? null,
  }));
  return [...owners().map((email) => ({ email, name: null, owner: true, rate: 0, base: "profit" as const, telegram_id: null })), ...users];
}

// Usuario del CRM que corresponde a un ID de Telegram (para saber quién vendió desde el robot)
export async function emailForTelegram(telegramId: number | undefined) {
  if (!telegramId) return null;
  const { data } = await adminDb().from("crm_users").select("email").eq("telegram_id", String(telegramId)).eq("active", true).maybeSingle();
  return (data?.email as string | undefined) ?? null;
}

export function commissionFor(item: Item, m: Pick<Member, "rate" | "base">) {
  if (!m.rate || item.sale_price == null) return 0;
  const base = m.base === "sale" ? Number(item.sale_price) : Math.max(0, margin(item)?.amount ?? 0);
  return Math.round(base * m.rate) / 100;
}

// Comisiones de un mes: por vendedor, con el detalle de cada venta
export async function monthlyCommissions(month: string) {
  const [y, mo] = month.split("-").map(Number);
  const start = `${month}-01`;
  const end = new Date(Date.UTC(y, mo, 1)).toISOString().slice(0, 10);
  const [{ data }, members] = await Promise.all([
    adminDb().from("inventory_items").select("*").eq("status", "sold").gte("sale_date", start).lt("sale_date", end).not("sold_by", "is", null),
    team(),
  ]);
  const byEmail = new Map(members.map((m) => [m.email, m]));
  const rows = new Map<string, { member: Member; sales: { sku: string; watch: string; date: string; price: number; commission: number }[]; total: number }>();
  for (const i of (data ?? []) as Item[]) {
    const m = byEmail.get(i.sold_by!) ?? { email: i.sold_by!, name: null, owner: false, rate: 0, base: "profit" as const, telegram_id: null };
    const c = commissionFor(i, m);
    const r = rows.get(m.email) ?? rows.set(m.email, { member: m, sales: [], total: 0 }).get(m.email)!;
    r.sales.push({ sku: i.sku, watch: [i.brand, i.model].filter(Boolean).join(" "), date: i.sale_date!, price: Number(i.sale_price ?? 0), commission: c });
    r.total += c;
  }
  return [...rows.values()].sort((a, b) => b.total - a.total);
}
