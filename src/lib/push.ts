import "server-only";
import webpush from "web-push";
import { adminDb } from "./supabase";
import { ALL_SECTIONS, type Section } from "./crm-perms";

// Avisos en el móvil y el ordenador desde la app del CRM (Web Push): nuevo lead, pago recibido y cita en
// una hora. Cada dispositivo se activa en CRM → Cuenta. En iPhone hace falta tener el CRM instalado
// (Compartir → Añadir a pantalla de inicio). Claves: NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY.

export const pushConfigured = () => Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);

let ready = false;
function setup() {
  if (ready || !pushConfigured()) return ready;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "https://theheuresociety.vercel.app", process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
  ready = true;
  return ready;
}

export type PushMessage = { title: string; body: string; url?: string; tag?: string };

// A todos los dispositivos del equipo con permiso para esa sección (sin sección: a todos)
export async function pushTeam(msg: PushMessage, section?: Section) {
  if (!setup()) return 0;
  const db = adminDb();
  const { data: subs } = await db.from("push_subscriptions").select("id, user_email, endpoint, p256dh, auth");
  if (!subs?.length) return 0;
  let allowed: Set<string> | null = null;
  if (section) {
    const { ownerEmails } = await import("./admin-auth");
    const { data: users } = await db.from("crm_users").select("email, permissions, active");
    allowed = new Set([...ownerEmails(), ...(users ?? []).filter((u) => u.active && ((u.permissions ?? []) as Section[]).includes(section)).map((u) => String(u.email).toLowerCase())]);
    if (!ALL_SECTIONS.includes(section)) allowed = null;
  }
  const payload = JSON.stringify({ title: msg.title, body: msg.body, url: msg.url ?? "/admin", tag: msg.tag });
  let sent = 0;
  for (const s of subs) {
    if (allowed && !allowed.has(String(s.user_email).toLowerCase())) continue;
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600 });
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      // El dispositivo ya no acepta avisos (desinstalado o permiso retirado): se borra
      if (code === 404 || code === 410) await db.from("push_subscriptions").delete().eq("id", s.id);
      else console.error("Aviso push:", code, (e as Error).message);
    }
  }
  return sent;
}

// Pasada de cada 10 minutos: citas que empiezan dentro de 50–70 minutos, una sola vez cada una
export async function pushAppointmentsSoon(now = Date.now()) {
  if (!pushConfigured()) return 0;
  const db = adminDb();
  const { data } = await db
    .from("appointments")
    .select("id, name, starts_at, kind, push_notified_at")
    .gte("starts_at", new Date(now + 50 * 60_000).toISOString())
    .lte("starts_at", new Date(now + 70 * 60_000).toISOString())
    .is("push_notified_at", null)
    .neq("status", "cancelled");
  let n = 0;
  for (const a of data ?? []) {
    await db.from("appointments").update({ push_notified_at: new Date().toISOString() }).eq("id", a.id);
    const time = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }).format(new Date(a.starts_at as string));
    n += await pushTeam({ title: `📅 Cita a las ${time}`, body: `${a.name ?? "Cliente"} · ${a.kind === "video" ? "videollamada" : "en la oficina"}`, url: "/admin/citas", tag: `appt-${a.id}` }, "citas");
  }
  return n;
}

// A los dispositivos de una persona (p. ej. el aviso de prueba)
export async function pushTo(email: string, msg: PushMessage) {
  if (!setup()) return 0;
  const db = adminDb();
  const { data: subs } = await db.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("user_email", email);
  let sent = 0;
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify({ ...msg, url: msg.url ?? "/admin" }), { TTL: 600 });
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await db.from("push_subscriptions").delete().eq("id", s.id);
    }
  }
  return sent;
}
