"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { authClient, isAllowed, requireAdmin } from "@/lib/admin-auth";
import { adminDb } from "@/lib/supabase";
import { addEvent, normalizePhone, STAGES, STAGE_LABEL, upsertLead, type Stage } from "@/lib/crm";
import { reactivateBot } from "@/lib/wa-bot";
import { createStockItem, itemForRequest } from "@/lib/stock";

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
  const { data: before } = await db.from("customers").select("*").eq("id", id).single();
  const stage = text(form, "stage") as Stage | null;
  const followAt = text(form, "follow_up_at");
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
  // Seguimiento (ganado o perdido lo cierra). Si falta la migración de seguimientos, se guarda lo demás.
  const closed = stage === "won" || stage === "lost";
  const follow = {
    follow_up_at: closed ? null : followAt && /^\d{4}-\d{2}-\d{2}$/.test(followAt) ? followAt : null,
    follow_up_note: closed ? null : text(form, "follow_up_note"),
  };
  let { error } = await db.from("customers").update({ ...patch, ...(before && "follow_up_at" in before && follow) }).eq("id", id);
  if (error && /follow_up/.test(error.message)) ({ error } = await db.from("customers").update(patch).eq("id", id));
  if (!error && before && "follow_up_at" in before && follow.follow_up_at && follow.follow_up_at !== before.follow_up_at) {
    await addEvent(id, "follow_up", `Seguimiento para el ${follow.follow_up_at}${follow.follow_up_note ? `: ${follow.follow_up_note}` : ""}`, {}, user);
  }
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

// Seguimiento hecho: se borra la fecha y queda en el historial (con lo que se hizo, si se escribe)
export async function completeFollowUp(id: string, form: FormData) {
  const user = await requireAdmin();
  const db = adminDb();
  const { data: c } = await db.from("customers").select("follow_up_note").eq("id", id).single();
  const done = text(form, "done");
  await db.from("customers").update({ follow_up_at: null, follow_up_note: null, last_activity_at: new Date().toISOString() }).eq("id", id);
  await addEvent(id, "follow_up", `Seguimiento hecho${c?.follow_up_note ? ` (${c.follow_up_note})` : ""}${done ? `: ${done}` : ""}`, {}, user);
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
  const { data: before } = await db.from("sell_requests").select("status").eq("id", id).single();
  const { data } = await db
    .from("sell_requests")
    .update({ ...(status && { status }), offer_amount: money(offer), notes: text(form, "notes"), updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  const changed = Boolean(status && before?.status !== status);
  if (data?.customer_id && changed) {
    const body = `Solicitud ${data.brand} ${data.model ?? ""}: ${SELL_STATUS[status!] ?? status}${offer ? ` · oferta ${offer}` : ""}`;
    await addEvent(data.customer_id, "sell_request", body.replace(/\s+/g, " "), { request: id }, user);
    // Trato cerrado: el cliente pasa a «ganado»
    if (status === "accepted" || status === "paid") {
      await db.from("customers").update({ stage: "won" }).eq("id", data.customer_id).neq("stage", "won");
    }
  }

  // Reloj recibido → entra solo al inventario (costo = la oferta; proveedor = el cliente)
  if (data && changed && status === "received" && !(await itemForRequest(id))) {
    const { data: c } = data.customer_id
      ? await db.from("customers").select("name, phone, email").eq("id", data.customer_id).single()
      : { data: null };
    const acquisition = data.kind === "consign" ? "consignment" : data.kind === "trade" ? "trade" : "purchase";
    const item = await createStockItem(
      {
        acquisition,
        brand: data.brand,
        model: data.model,
        reference: data.reference,
        description: data.message,
        supplier_customer_id: data.customer_id,
        supplier_name: c?.name ?? data.name,
        supplier_location: null,
        purchase_date: new Date().toISOString().slice(0, 10),
        cost: data.offer_amount,
        notes: (data.image_paths as string[])?.length ? `Fotos del cliente: ${(data.image_paths as string[]).join(" ")}` : null,
        sell_request_id: id,
      },
      user,
      `Entrada desde Compras (${SELL_STATUS.received})${data.offer_amount ? ` · costo $${Number(data.offer_amount).toLocaleString("en-US")}` : " · falta el costo"}`
    );
    if (data.customer_id) await addEvent(data.customer_id, "sell_request", `Su reloj entró al inventario (${item.sku})`, { item: item.id }, user);
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
