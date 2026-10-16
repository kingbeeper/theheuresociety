import "server-only";
import { adminDb } from "./supabase";
import { addEvent } from "./crm";
import { getDocSettings } from "./documents";
import { emailReady, sendEmail, simpleEmail } from "./email";
import { paidSoFar, type Doc } from "./doc-labels";
import { escapeHtml as h } from "./telegram";

// Cobros pendientes: facturas enviadas sin pagar y proformas con saldo. Recordatorio al cliente (correo
// automático + mensaje de WhatsApp preparado) y aviso diario en Telegram de lo vencido.

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://theheuresociety.vercel.app").replace(/\/$/, "");
export const AUTO_KEY = "auto_payment_reminders"; // «off» para no enviar recordatorios automáticos
export const AUTO_EVERY_DAYS = 7; // un recordatorio automático por semana como máximo
export const AUTO_MAX = 3; // y como mucho 3 automáticos por documento
const DAY = 86_400_000;

export type Receivable = Doc & { balance: number; overdueDays: number | null };

const miamiToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY);

export async function receivables() {
  const { data } = await adminDb().from("documents").select("*").in("kind", ["invoice", "proforma"]).eq("status", "sent").order("due_date", { ascending: true, nullsFirst: false });
  const today = miamiToday();
  return ((data ?? []) as Doc[])
    .map((d) => {
      const balance = Math.max(0, Math.round((Number(d.total) - paidSoFar(d)) * 100) / 100);
      return { ...d, balance, overdueDays: d.due_date && d.due_date < today ? days(d.due_date, today) : null } as Receivable;
    })
    .filter((d) => d.balance > 0);
}

const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDue = (iso: string, es: boolean) => new Date(`${iso}T12:00:00`).toLocaleDateString(es ? "es-US" : "en-US", { month: "long", day: "numeric", year: "numeric" });

// Mensaje para el cliente (idioma del documento), con el saldo, la fecha y cómo pagar
export function reminderText(d: Receivable, paymentInfo: string) {
  const es = d.lang === "es";
  const first = (d.client_name ?? "").split(" ")[0];
  const label = d.kind === "proforma" ? (es ? "factura" : "invoice") : es ? "factura" : "invoice";
  const due = d.due_date ? fmtDue(d.due_date, es) : null;
  const late = d.overdueDays && d.overdueDays > 0;
  const lines = es
    ? [
        `Hola ${first}, le escribimos de The Heure Society por su ${label} ${d.number}.`,
        `Saldo pendiente: ${usd(d.balance)}${due ? (late ? ` (vencía el ${due})` : ` · vence el ${due}`) : ""}.`,
        paymentInfo ? `Datos para el pago:\n${paymentInfo}` : "",
        `Puede ver el documento aquí: ${SITE}/d/${d.token}`,
        "Si ya lo pagó, por favor ignore este mensaje y gracias. Cualquier duda, aquí estamos.",
      ]
    : [
        `Hi ${first}, this is The Heure Society regarding your ${label} ${d.number}.`,
        `Balance due: ${usd(d.balance)}${due ? (late ? ` (was due ${due})` : ` · due ${due}`) : ""}.`,
        paymentInfo ? `Payment details:\n${paymentInfo}` : "",
        `You can view the document here: ${SITE}/d/${d.token}`,
        "If you've already paid, please disregard this message, and thank you. Any questions, we're here to help.",
      ];
  return lines.filter(Boolean).join("\n\n");
}

export const waReminderLink = (d: Receivable, paymentInfo: string) => {
  const phone = d.client_phone?.replace(/\D/g, "");
  return phone ? `https://wa.me/${phone}?text=${encodeURIComponent(reminderText(d, paymentInfo))}` : null;
};

// Envía el recordatorio por correo (si hay correo) y lo anota; con channel «whatsapp» solo lo anota
export async function remindClient(d: Receivable, user: string, channel: "email" | "whatsapp" = "email") {
  const settings = await getDocSettings();
  let emailed = false;
  if (channel === "email") {
    if (!d.client_email || !emailReady()) return { emailed: false };
    const es = d.lang === "es";
    await sendEmail(
      d.client_email,
      es ? `Recordatorio de pago · ${d.number}` : `Payment reminder · ${d.number}`,
      simpleEmail(reminderText(d, settings.doc_payment_info).split("\n\n").filter((p) => !p.includes(`/d/${d.token}`)), { label: es ? "Ver el documento" : "View document", url: `${SITE}/d/${d.token}` })
    );
    emailed = true;
  }
  await adminDb().from("documents").update({ last_reminder_at: new Date().toISOString(), reminder_count: (d.reminder_count ?? 0) + 1 }).eq("id", d.id);
  if (d.customer_id) await addEvent(d.customer_id, "payment_reminder", `💌 Recordatorio de pago ${d.number} (${usd(d.balance)}) por ${channel === "email" ? "correo" : "WhatsApp"}`, { document: d.id }, user);
  return { emailed };
}

export async function autoRemindersOn() {
  const { data } = await adminDb().from("integration_settings").select("value").eq("key", AUTO_KEY).maybeSingle();
  return data?.value !== "off";
}

// Pasada diaria (con el resumen de la mañana): recordatorio automático a los vencidos con correo,
// como mucho uno por semana y 3 por documento. Devuelve el texto para Telegram.
export async function dailyCollections() {
  const list = await receivables();
  const overdue = list.filter((d) => d.overdueDays && d.overdueDays > 0);
  const sent: string[] = [];
  if (await autoRemindersOn()) {
    for (const d of overdue) {
      if (!d.client_email || (d.reminder_count ?? 0) >= AUTO_MAX) continue;
      if (d.last_reminder_at && Date.now() - Date.parse(d.last_reminder_at) < AUTO_EVERY_DAYS * DAY) continue;
      const r = await remindClient(d, "sistema").catch(() => ({ emailed: false }));
      if (r.emailed) sent.push(d.number);
    }
  }
  if (!list.length) return null;
  const total = list.reduce((a, d) => a + d.balance, 0);
  const lateTotal = overdue.reduce((a, d) => a + d.balance, 0);
  return [
    `💰 <b>Cobros pendientes</b>: ${usd(total)} en ${list.length} documento(s)${overdue.length ? ` · <b>${usd(lateTotal)} vencido</b>` : ""}`,
    ...overdue.slice(0, 6).map((d) => `• ${h(d.number)} · ${h(d.client_name ?? "")} · ${usd(d.balance)} · ${d.overdueDays} día(s) de retraso`),
    sent.length ? `✉️ Recordatorio automático enviado: ${sent.join(", ")}` : "",
  ].filter(Boolean).join("\n");
}
