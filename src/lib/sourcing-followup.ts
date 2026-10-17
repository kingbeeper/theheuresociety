import "server-only";
import { adminDb } from "./supabase";
import { addEvent } from "./crm";
import { miamiToUtc } from "./booking";
import type { Doc } from "./doc-labels";

// Recordatorio de seguimiento de un encargo: en X días, a las 10:00 (Miami). Sale en Tareas, en el
// calendario sincronizado, en «Clientes de hoy» y llega por Telegram a su hora.
export async function sourcingReminder(d: Pick<Doc, "id" | "number" | "customer_id" | "items">, inDays: number, user: string, chatId: number | null = null) {
  if (!d.customer_id || !(inDays > 0)) return null;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  const day = new Date(Date.parse(`${today}T12:00:00Z`) + inDays * 86_400_000).toISOString().slice(0, 10);
  const due = miamiToUtc(day, "10:00");
  const what = d.items[0]?.title ?? "la pieza";
  const body = `Encargo ${d.number}: ${what}. ¿Apareció? Dar seguimiento al cliente.`;
  const db = adminDb();
  const { data: r, error } = await db.from("reminders").insert({ customer_id: d.customer_id, body, due_at: due.toISOString(), all_day: false, chat_id: chatId, created_by: user }).select("id").single();
  if (error || !r) return null;
  await db.from("customers").update({ follow_up_at: day, follow_up_note: `⏰ ${body}`.slice(0, 300) }).eq("id", d.customer_id);
  await addEvent(d.customer_id, "follow_up", `Recordatorio de seguimiento del encargo ${d.number} para el ${day}`, { reminder: r.id, document: d.id }, user);
  return { id: r.id as string, day };
}
