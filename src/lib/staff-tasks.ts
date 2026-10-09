import "server-only";
import { adminDb } from "./supabase";
import { escapeHtml as h, keyboard, notifyAdmins, sendMessage } from "./telegram";
import { team } from "./team";

// Tareas internas del equipo («llamar a Juan», «llevar el Nautilus al relojero»), con aviso por
// Telegram a quien se le asigna.

export type StaffTask = {
  id: string; title: string; notes: string | null; assignee: string; due_date: string | null;
  customer_id: string | null; item_id: string | null; done_at: string | null; created_by: string | null; created_at: string;
};

export async function openTasks(assignee?: string) {
  let q = adminDb().from("staff_tasks").select("*").is("done_at", null).order("due_date", { ascending: true, nullsFirst: false }).order("created_at");
  if (assignee) q = q.eq("assignee", assignee);
  const { data, error } = await q;
  return error ? [] : ((data ?? []) as StaffTask[]);
}

const label = (t: StaffTask) => `${t.due_date ? `📅 ${t.due_date} · ` : ""}${t.title}`;

// Aviso por Telegram: al usuario si tiene su ID enlazado; si es superadministrador, a los administradores
async function notifyAssignee(t: StaffTask, text: string) {
  const member = (await team()).find((m) => m.email === t.assignee);
  const extra = { reply_markup: keyboard([[{ text: "✓ Hecha", callback_data: `dstk:${t.id}` }]]) };
  if (member?.telegram_id) return sendMessage(Number(member.telegram_id), text, extra).catch(() => {});
  if (member?.owner) return notifyAdmins(text, extra).catch(() => {});
}

export async function createTask(fields: Omit<StaffTask, "id" | "done_at" | "created_at">) {
  const { data, error } = await adminDb().from("staff_tasks").insert(fields).select("*").single();
  if (error) throw error;
  const t = data as StaffTask;
  await notifyAssignee(t, `📝 <b>Tarea nueva</b>${t.created_by ? ` de ${h(t.created_by)}` : ""}\n${h(label(t))}${t.notes ? `\n<i>${h(t.notes)}</i>` : ""}`);
  return t;
}

export async function completeStaffTask(id: string, by: string) {
  const { data } = await adminDb().from("staff_tasks").update({ done_at: new Date().toISOString() }).eq("id", id).is("done_at", null).select("*").maybeSingle();
  const t = data as StaffTask | null;
  // Quien la encargó se entera (si no la hizo él mismo)
  if (t?.created_by && t.created_by !== by && t.created_by !== t.assignee) {
    const member = (await team()).find((m) => m.email === t.created_by);
    const text = `✅ ${h(by)} terminó: ${h(t.title)}`;
    if (member?.telegram_id) await sendMessage(Number(member.telegram_id), text).catch(() => {});
    else if (member?.owner) await notifyAdmins(text).catch(() => {});
  }
  return t;
}

// Telegram: las tareas de quien escribe (o todas, si es un administrador sin usuario enlazado)
export async function sendTaskList(chatId: number, actor: string) {
  const mine = /@/.test(actor) ? await openTasks(actor) : await openTasks();
  if (!mine.length) return false;
  await sendMessage(chatId, `<b>📝 Tareas pendientes</b> (${mine.length})`);
  for (const t of mine.slice(0, 10)) {
    await sendMessage(chatId, `${h(label(t))}${/@/.test(actor) ? "" : `\n<i>${h(t.assignee)}</i>`}${t.notes ? `\n${h(t.notes)}` : ""}`, {
      reply_markup: keyboard([[{ text: "✓ Hecha", callback_data: `dstk:${t.id}` }]]),
    });
  }
  return true;
}
