"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { authClient, isAllowed, requireAdmin } from "@/lib/admin-auth";
import { adminDb } from "@/lib/supabase";
import { addEvent, normalizePhone, STAGES, STAGE_LABEL, upsertLead, type Stage } from "@/lib/crm";
import { reactivateBot } from "@/lib/wa-bot";

// Acciones del CRM. Cada una comprueba primero que quien la ejecuta es un usuario autorizado.

export async function signIn(_: unknown, form: FormData) {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  if (!isAllowed(email)) return { error: "Correo o contraseña incorrectos." };
  const { error } = await (await authClient()).auth.signInWithPassword({ email, password });
  if (error) return { error: "Correo o contraseña incorrectos." };
  redirect("/admin");
}

export async function signOut() {
  await (await authClient()).auth.signOut();
  redirect("/admin/login");
}

const text = (form: FormData, key: string) => {
  const v = String(form.get(key) ?? "").trim();
  return v || null;
};

const money = (v: string | null) => (v ? Number(v.replace(/[^\d.]/g, "")) || null : null);

export async function createLead(form: FormData) {
  const user = await requireAdmin();
  const customer = await upsertLead({
    name: text(form, "name"),
    phone: text(form, "phone"),
    email: text(form, "email"),
    source: text(form, "source") ?? "other",
    intent: text(form, "intent"),
    interests: text(form, "interests"),
    notify: false,
    event: { type: "note", body: `Alta manual por ${user}` },
  });
  redirect(`/admin/leads/${customer.id}`);
}

export async function updateLead(id: string, _: unknown, form: FormData) {
  const user = await requireAdmin();
  const db = adminDb();
  const { data: before } = await db.from("customers").select("stage").eq("id", id).single();
  const stage = text(form, "stage") as Stage | null;
  const patch = {
    name: text(form, "name"),
    phone: normalizePhone(text(form, "phone")),
    email: text(form, "email")?.toLowerCase() ?? null,
    intent: text(form, "intent"),
    interests: text(form, "interests"),
    notes: text(form, "notes"),
    budget: money(text(form, "budget")),
    tags: (text(form, "tags") ?? "").split(",").map((t) => t.trim()).filter(Boolean),
    ...(stage && STAGES.includes(stage) && { stage }),
    updated_at: new Date().toISOString(),
  };
  const { error } = await db.from("customers").update(patch).eq("id", id);
  if (error) return { error: error.code === "23505" ? "Ese teléfono o correo ya pertenece a otro cliente." : error.message };
  if (stage && before?.stage !== stage) await addEvent(id, "stage", `Etapa: ${STAGE_LABEL[stage]}`, { from: before?.stage, to: stage }, user);
  refresh();
  return { ok: true };
}

export async function setStage(id: string, stage: Stage) {
  const user = await requireAdmin();
  if (!STAGES.includes(stage)) return;
  const db = adminDb();
  const { data: before } = await db.from("customers").select("stage").eq("id", id).single();
  if (before?.stage === stage) return;
  await db.from("customers").update({ stage, updated_at: new Date().toISOString() }).eq("id", id);
  await addEvent(id, "stage", `Etapa: ${STAGE_LABEL[stage]}`, { from: before?.stage, to: stage }, user);
  refresh();
}

export async function addNote(id: string, form: FormData) {
  const user = await requireAdmin();
  const body = text(form, "note");
  if (!body) return;
  await addEvent(id, "note", body, {}, user);
  await adminDb().from("customers").update({ last_activity_at: new Date().toISOString() }).eq("id", id);
  refresh();
}

export async function toggleAlert(alertId: string, active: boolean) {
  await requireAdmin();
  await adminDb().from("watch_alerts").update({ active }).eq("id", alertId);
  refresh();
}

// Pausar o reactivar el bot de WhatsApp en la conversación de un cliente
export async function setBot(waId: string, on: boolean) {
  await requireAdmin();
  if (on) await reactivateBot(waId);
  else
    await adminDb()
      .from("wa_contacts")
      .update({ mode: "human", human_until: new Date(Date.now() + 7 * 86_400_000).toISOString() })
      .eq("wa_id", waId);
  refresh();
}

export async function setAppointmentStatus(id: string, status: "requested" | "confirmed" | "cancelled") {
  const user = await requireAdmin();
  const { data } = await adminDb().from("appointments").update({ status }).eq("id", id).select("customer_id").single();
  if (data?.customer_id) {
    const label = { requested: "pendiente", confirmed: "confirmada", cancelled: "cancelada" }[status];
    await addEvent(data.customer_id, "appointment", `Cita ${label}`, { appointment: id }, user);
  }
  refresh();
}

export async function updateSellRequest(id: string, form: FormData) {
  const user = await requireAdmin();
  const status = text(form, "status");
  const offer = text(form, "offer");
  const db = adminDb();
  const { data } = await db
    .from("sell_requests")
    .update({ ...(status && { status }), offer_amount: money(offer), notes: text(form, "notes"), updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("customer_id, brand, model")
    .single();
  if (data?.customer_id && status) {
    const body = `Solicitud ${data.brand} ${data.model ?? ""}: ${SELL_STATUS[status] ?? status}${offer ? ` · oferta ${offer}` : ""}`;
    await addEvent(data.customer_id, "sell_request", body.replace(/\s+/g, " "), { request: id }, user);
    // Trato cerrado: el cliente pasa a «ganado»
    if (status === "accepted" || status === "paid") {
      await db.from("customers").update({ stage: "won" }).eq("id", data.customer_id).neq("stage", "won");
    }
  }
  refresh();
}

const SELL_STATUS: Record<string, string> = {
  new: "nueva",
  offered: "ofertada",
  accepted: "aceptada",
  received: "reloj recibido",
  paid: "pagada",
  rejected: "rechazada",
};

// ───────────────────────────── Redes (Instagram y Facebook) ─────────────────────────────
export async function saveSocialSettings(form: FormData) {
  await requireAdmin();
  const { saveSettings } = await import("@/lib/meta");
  await saveSettings({
    bot_dm: form.get("bot_dm") === "on" ? "on" : "off",
    comment_reply: form.get("comment_reply") === "on" ? "on" : "off",
    comment_reply_text: text(form, "comment_reply_text"),
  });
  refresh();
}

export async function disconnectSocial() {
  await requireAdmin();
  const { saveSettings } = await import("@/lib/meta");
  await saveSettings({ page_id: null, page_name: null, page_token: null, ig_id: null, ig_username: null, connected_at: null, connected_by: null });
  refresh();
}

export async function setSocialBot(contactId: string, on: boolean) {
  await requireAdmin();
  if (on) {
    const { reactivateSocialBot } = await import("@/lib/social-bot");
    await reactivateSocialBot(contactId);
  } else {
    await adminDb().from("social_contacts").update({ mode: "human", human_until: new Date(Date.now() + 7 * 86_400_000).toISOString() }).eq("id", contactId);
  }
  refresh();
}
