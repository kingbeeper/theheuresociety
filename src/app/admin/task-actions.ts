"use server";

import { refresh } from "next/cache";
import { requireUser } from "@/lib/admin-auth";
import { completeStaffTask, createTask } from "@/lib/staff-tasks";

// Tareas del equipo: cualquier usuario del CRM puede crear y completar las suyas
const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim() || null;

export async function createStaffTask(f: FormData) {
  const user = await requireUser();
  const title = text(f, "title");
  if (!title) return;
  const due = text(f, "due_date");
  await createTask({
    title: title.slice(0, 200),
    notes: text(f, "notes"),
    assignee: text(f, "assignee") ?? user.email,
    due_date: due && /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null,
    customer_id: text(f, "customer_id"),
    item_id: text(f, "item_id"),
    created_by: user.email,
  });
  refresh();
}

export async function completeStaffTaskAction(id: string) {
  const user = await requireUser();
  await completeStaffTask(id, user.email);
  refresh();
}
