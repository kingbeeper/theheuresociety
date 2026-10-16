"use server";

import { tr } from "@/lib/admin-i18n";
import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { authClient, isAllowed, requireAdmin } from "@/lib/admin-auth";
import { adminDb } from "@/lib/supabase";
import { addEvent, normalizePhone, STAGES, STAGE_LABEL, upsertLead, type Stage } from "@/lib/crm";
import { reactivateBot } from "@/lib/wa-bot";
import { createStockItem, itemForRequest } from "@/lib/stock";
import { miamiToUtc, slotClash } from "@/lib/booking";
import { addAppointment, addFollowupNote, clashText, completeCall, followupAppointment, scheduleCall, setOutcome, whenText } from "@/lib/appointments";

// Acciones del CRM. Cada una comprueba primero que quien la ejecuta es un usuario autorizado.

export async function signIn(_: unknown, form: FormData) {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  if (!(await isAllowed(email))) return { error: tr("Correo o contraseña incorrectos.") };
  const { error } = await (await authClient()).auth.signInWithPassword({ email, password });
  if (error) return { error: tr("Correo o contraseña incorrectos.") };
  redirect("/admin");
}

export async function signOut() {
  await (await authClient()).auth.signOut();
  redirect("/admin/login");
}

// Idioma del CRM (ES / EN) para este usuario en este dispositivo
export async function setLangAction(lang: "es" | "en") {
  const { cookies } = await import("next/headers");
  const { LANG_COOKIE } = await import("@/lib/admin-i18n");
  (await cookies()).set(LANG_COOKIE, lang === "en" ? "en" : "es", { path: "/admin", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", httpOnly: true, secure: true });
  refresh();
}

const text = (form: FormData, key: string) => {
  const v = String(form.get(key) ?? "").trim();
  return v || null;
};

const money = (v: string | null) => (v ? Number(v.replace(/[^\d.]/g, "")) || null : null);

export async function createLead(form: FormData) {
  const user = await requireAdmin("leads");
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
  const user = await requireAdmin("leads");
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
  const user = await requireAdmin("leads");
  if (!STAGES.includes(stage)) return;
  const db = adminDb();
  const { data: before } = await db.from("customers").select("stage").eq("id", id).single();
  if (before?.stage === stage) return;
  await db.from("customers").update({ stage, updated_at: new Date().toISOString() }).eq("id", id);
  await addEvent(id, "stage", `Etapa: ${STAGE_LABEL[stage]}`, { from: before?.stage, to: stage }, user);
  refresh();
}

export async function addNote(id: string, form: FormData) {
  const user = await requireAdmin("leads");
  const body = text(form, "note");
  if (!body) return;
  await addEvent(id, "note", body, {}, user);
  await adminDb().from("customers").update({ last_activity_at: new Date().toISOString() }).eq("id", id);
  refresh();
}

// Seguimiento hecho: se borra la fecha y queda en el historial (con lo que se hizo, si se escribe)
export async function completeFollowUp(id: string, form: FormData) {
  const user = await requireAdmin("leads");
  const db = adminDb();
  const { data: c } = await db.from("customers").select("follow_up_note").eq("id", id).single();
  const done = text(form, "done");
  await db.from("customers").update({ follow_up_at: null, follow_up_note: null, last_activity_at: new Date().toISOString() }).eq("id", id);
  await addEvent(id, "follow_up", `Seguimiento hecho${c?.follow_up_note ? ` (${c.follow_up_note})` : ""}${done ? `: ${done}` : ""}`, {}, user);
  refresh();
}

export async function completeTaskAction(id: string) {
  const user = await requireAdmin("leads");
  const { completeTask } = await import("@/lib/tasks");
  await completeTask(id, user);
  refresh();
}

export async function toggleAlert(alertId: string, active: boolean) {
  await requireAdmin("leads");
  await adminDb().from("watch_alerts").update({ active }).eq("id", alertId);
  refresh();
}

// Pausar o reactivar el bot de WhatsApp en la conversación de un cliente
export async function setBot(waId: string, on: boolean) {
  await requireAdmin("leads");
  if (on) await reactivateBot(waId);
  else
    await adminDb()
      .from("wa_contacts")
      .update({ mode: "human", human_until: new Date(Date.now() + 7 * 86_400_000).toISOString() })
      .eq("wa_id", waId);
  refresh();
}

export async function setAppointmentStatus(id: string, status: "requested" | "confirmed" | "cancelled") {
  const user = await requireAdmin("citas");
  const { data } = await adminDb().from("appointments").update({ status }).eq("id", id).select("customer_id").single();
  if (data?.customer_id) {
    const label = { requested: "pendiente", confirmed: "confirmada", cancelled: "cancelada" }[status];
    await addEvent(data.customer_id, "appointment", `Cita ${label}`, { appointment: id }, user);
  }
  refresh();
}

// ───────────────────────────── Citas manuales ─────────────────────────────
// La lógica es la misma que en Telegram (lib/appointments): horario ocupado para todos los canales.
export async function createAppointment(_: unknown, form: FormData) {
  const user = await requireAdmin("citas");
  const r = await addAppointment(
    {
      customerId: text(form, "customer_id"),
      name: text(form, "name"),
      phone: text(form, "phone"),
      email: text(form, "email"),
      source: text(form, "source"),
      date: text(form, "date") ?? "",
      time: text(form, "time") ?? "",
      kind: text(form, "kind") === "video" ? "video" : "office",
      note: text(form, "note"),
      pieces: form.getAll("pieces").map(String).filter(Boolean),
      confirmed: form.get("confirmed") === "on",
      force: form.get("force") === "on",
    },
    user
  );
  if ("error" in r) return r;
  refresh();
  return { ok: true };
}

// ───────────────────────────── Seguimiento de una cita ─────────────────────────────
export async function apptNoteAction(id: string, form: FormData) {
  const user = await requireAdmin("citas");
  const body = text(form, "body");
  if (body) await addFollowupNote(id, body.slice(0, 1000), user);
  refresh();
}

export async function apptCallAction(id: string, form: FormData) {
  const user = await requireAdmin("citas");
  const date = text(form, "date");
  if (date) await scheduleCall(id, date, text(form, "note"), user, text(form, "time"));
  refresh();
}

export async function apptCallDoneAction(followupId: string, form: FormData) {
  const user = await requireAdmin("citas");
  await completeCall(followupId, text(form, "result"), user);
  refresh();
}

export async function apptOutcomeAction(id: string, outcome: string) {
  const user = await requireAdmin("citas");
  await setOutcome(id, outcome, user);
  refresh();
}

// Otra cita (o llamada por video) para el mismo cliente, enlazada a esta
export async function apptNextAction(id: string, _: unknown, form: FormData) {
  const user = await requireAdmin("citas");
  const r = await followupAppointment(
    id,
    { date: text(form, "date") ?? "", time: text(form, "time") ?? "", kind: text(form, "kind") === "video" ? "video" : "office", note: text(form, "note"), confirmed: true, force: form.get("force") === "on" },
    user
  );
  if ("error" in r) return r;
  refresh();
  return { ok: true };
}

// ───────────────────────────── Recordatorios de un cliente ─────────────────────────────
export async function addReminderAction(customerId: string, form: FormData) {
  const user = await requireAdmin("leads");
  const body = text(form, "body");
  const date = text(form, "date");
  if (!body || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  const time = text(form, "time");
  const allDay = !time;
  const due = miamiToUtc(date, time ?? "09:00");
  const db = adminDb();
  const { data: r } = await db.from("reminders").insert({ customer_id: customerId, body: body.slice(0, 500), due_at: due.toISOString(), all_day: allDay, created_by: user }).select("id").single();
  await db.from("customers").update({ follow_up_at: date, follow_up_note: `⏰ ${body}`.slice(0, 300), last_activity_at: new Date().toISOString() }).eq("id", customerId);
  await addEvent(customerId, "follow_up", `Recordatorio para el ${date}${time ? ` a las ${time}` : ""}: ${body}`, { reminder: r?.id }, user);
  refresh();
}

export async function snoozeReminderAction(id: string, days: number) {
  await requireAdmin("leads");
  const db = adminDb();
  const { data: r } = await db.from("reminders").select("due_at, customer_id").eq("id", id).single();
  if (!r) return;
  const next = new Date(Math.max(Date.now(), new Date(r.due_at).getTime()) + days * 86_400_000);
  await db.from("reminders").update({ due_at: next.toISOString(), notified_at: null }).eq("id", id);
  if (r.customer_id) await db.from("customers").update({ follow_up_at: new Intl.DateTimeFormat("sv-SE", { timeZone: "America/New_York" }).format(next) }).eq("id", r.customer_id);
  refresh();
}

export async function reminderDoneAction(id: string) {
  const user = await requireAdmin("leads");
  const db = adminDb();
  const { data: r } = await db.from("reminders").update({ done_at: new Date().toISOString() }).eq("id", id).select("customer_id, body, due_at").single();
  if (r?.customer_id) {
    // El seguimiento del cliente de ese día queda hecho (igual que al cerrarlo en Telegram)
    const day = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/New_York" }).format(new Date(r.due_at));
    await db.from("customers").update({ follow_up_at: null, follow_up_note: null }).eq("id", r.customer_id).eq("follow_up_at", day);
    await addEvent(r.customer_id, "follow_up", `Recordatorio hecho: ${r.body}`, { reminder: id }, user);
  }
  refresh();
}

// Cambiar día u hora de una cita (sigue bloqueando un solo horario)
export async function rescheduleAppointment(id: string, _: unknown, form: FormData) {
  const user = await requireAdmin("citas");
  const date = text(form, "date");
  const time = text(form, "time");
  if (!date || !time) return { error: tr("Falta la fecha o la hora.") };
  const startsAt = miamiToUtc(date, time);
  const clash = await slotClash(startsAt, id);
  if (clash && form.get("force") !== "on") return { error: clashText(clash), clash: true };
  const { data, error } = await adminDb().from("appointments").update({ starts_at: startsAt.toISOString() }).eq("id", id).select("customer_id").single();
  if (error) return { error: error.code === "23505" ? "Ya hay otra cita exactamente a esa hora." : error.message };
  if (data?.customer_id) await addEvent(data.customer_id, "appointment", `Cita cambiada al ${whenText(startsAt)}`, { appointment: id }, user);
  refresh();
  return { ok: true };
}

export async function updateSellRequest(id: string, form: FormData) {
  const user = await requireAdmin("compras");
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
  await requireAdmin("redes");
  const { saveSettings } = await import("@/lib/meta");
  await saveSettings({
    bot_dm: form.get("bot_dm") === "on" ? "on" : "off",
    comment_reply: form.get("comment_reply") === "on" ? "on" : "off",
    comment_reply_text: text(form, "comment_reply_text"),
    ...(form.has("comment_keywords") && { comment_keywords: text(form, "comment_keywords") }),
    ...(form.has("competitors") && { competitors: text(form, "competitors") }),
  });
  refresh();
}

export async function disconnectSocial() {
  await requireAdmin("redes");
  const { saveSettings } = await import("@/lib/meta");
  await saveSettings({ page_id: null, page_name: null, page_token: null, ig_id: null, ig_username: null, connected_at: null, connected_by: null });
  refresh();
}

export async function setSocialBot(contactId: string, on: boolean) {
  await requireAdmin("leads");
  if (on) {
    const { reactivateSocialBot } = await import("@/lib/social-bot");
    await reactivateSocialBot(contactId);
  } else {
    await adminDb().from("social_contacts").update({ mode: "human", human_until: new Date(Date.now() + 7 * 86_400_000).toISOString() }).eq("id", contactId);
  }
  refresh();
}

// ───────────────────────────── Gastos generales del negocio ─────────────────────────────
export async function addExpenseAction(form: FormData) {
  const user = await requireAdmin("costos");
  const amount = Number(String(form.get("amount") ?? "").replace(/[^\d.]/g, ""));
  const date = text(form, "spent_on");
  if (!amount || amount <= 0) return;
  const { addExpense } = await import("@/lib/expenses");
  await addExpense({ spent_on: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Date().toISOString().slice(0, 10), category: text(form, "category") ?? "other", amount, note: text(form, "note") }, user);
  refresh();
}

export async function deleteExpenseAction(id: string) {
  await requireAdmin("costos");
  await adminDb().from("business_expenses").delete().eq("id", id);
  refresh();
}

// ───────────────────────────── Etiquetas, duplicados y dealers ─────────────────────────────
export async function toggleTagAction(id: string, tag: string) {
  const user = await requireAdmin("leads");
  const db = adminDb();
  const { data } = await db.from("customers").select("tags").eq("id", id).single();
  const tags = (data?.tags ?? []) as string[];
  const on = tags.some((t) => t.toLowerCase() === tag.toLowerCase());
  const next = on ? tags.filter((t) => t.toLowerCase() !== tag.toLowerCase()) : [...tags, tag];
  await db.from("customers").update({ tags: next, updated_at: new Date().toISOString() }).eq("id", id);
  await addEvent(id, "tag", `${on ? "Quitada" : "Añadida"} la etiqueta «${tag}»`, {}, user);
  refresh();
}

export async function mergeAction(keepId: string, dropId: string) {
  const user = await requireAdmin("leads");
  const { mergeCustomers } = await import("@/lib/merge");
  await mergeCustomers(keepId, dropId, user);
  refresh();
}

export async function askDealersAction(_: unknown, form: FormData) {
  const user = await requireAdmin("leads");
  const query = text(form, "query");
  if (!query) return { error: tr("Escribe qué reloj buscas.") };
  const ids = form.getAll("dealer").map(String).filter(Boolean);
  if (!ids.length) return { error: tr("Elige al menos un dealer.") };
  const budget = Number(String(form.get("budget") ?? "").replace(/[^\d.]/g, "")) || null;
  const { askDealers } = await import("@/lib/dealers");
  await askDealers(query.slice(0, 300), budget, ids, text(form, "document_id"), user);
  refresh();
  return { ok: true };
}

export async function answerDealerAction(id: string, form: FormData) {
  const user = await requireAdmin("leads");
  const status = text(form, "status") as "has" | "no" | "offered" | "asked" | null;
  if (!status) return;
  const price = Number(String(form.get("price") ?? "").replace(/[^\d.]/g, "")) || null;
  const { answerDealer } = await import("@/lib/dealers");
  await answerDealer(id, price && status === "has" ? "offered" : status, price, text(form, "note"), user);
  refresh();
}

// Conservar una ficha y fusionar en ella las demás del grupo de duplicados
export async function mergeGroupAction(keepId: string, dropIds: string[]) {
  const user = await requireAdmin("leads");
  const { mergeCustomers } = await import("@/lib/merge");
  for (const id of dropIds) if (id !== keepId) await mergeCustomers(keepId, id, user);
  refresh();
}

// Nuevo dealer desde la página de Dealers: si ya existe (mismo teléfono o correo) solo se le añade la etiqueta
export async function addDealerAction(_: unknown, form: FormData) {
  const user = await requireAdmin("leads");
  const name = text(form, "name");
  const phone = text(form, "phone");
  const email = text(form, "email");
  const company = text(form, "company");
  if (!name) return { error: tr("Escribe el nombre del dealer.") };
  if (!phone && !email) return { error: tr("Pon al menos el teléfono (WhatsApp) o el correo.") };
  if (phone && !normalizePhone(phone)) return { error: tr("El teléfono no parece válido. Escríbelo con código de país, p. ej. +1 305 555 1234.") };
  const { addDealer } = await import("@/lib/dealers");
  const c = await addDealer({ name, phone, email, company }, user);
  refresh();
  return { ok: c.name ?? name };
}

// Oferta registrada a mano (en persona o por teléfono): crea la ficha del cliente y la tarjeta en «Ofertas de
// clientes». Devuelve enlaces firmados para que el navegador suba las fotos directamente al almacenamiento.
export async function createOfferAction(input: { kind: string; name: string; phone?: string; email?: string; brand: string; model?: string; reference?: string; asking?: string; details?: string; photos: { type: string }[] }) {
  const user = await requireAdmin("compras");
  const kind = ["sell", "trade", "consign"].includes(input.kind) ? input.kind : "sell";
  if (!input.name?.trim() || !input.brand?.trim()) return { error: tr("Faltan el nombre del cliente y la marca del reloj.") };
  const { createOffer } = await import("@/lib/offers");
  const r = await createOffer({ ...input, kind: kind as "sell" | "trade" | "consign" }, user);
  refresh();
  return r;
}

export async function offerPhotosAction(id: string, urls: string[]) {
  await requireAdmin("compras");
  await adminDb().from("sell_requests").update({ image_paths: urls, updated_at: new Date().toISOString() }).eq("id", id);
  refresh();
}

// Tasar una oferta de cliente (≈ 1 minuto: busca anuncios actuales)
export async function offerMarketAction(id: string) {
  await requireAdmin("compras");
  const { appraiseOffer } = await import("@/lib/offers");
  await appraiseOffer(id);
  refresh();
}
