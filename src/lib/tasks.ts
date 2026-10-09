import "server-only";
import { adminDb } from "./supabase";
import { addEvent } from "./crm";

// Tareas de postventa: se programan solas al vender un reloj y aparecen en el panel, en el
// resumen diario y en Telegram, con el mensaje de WhatsApp ya escrito (un toque y se envía).

export const TASK_LABEL: Record<string, string> = {
  review: "Pedir reseña en Google",
  anniversary: "Aniversario de compra: proponer intercambio",
  service: "Recordar el mantenimiento del reloj",
  custom: "Seguimiento",
};

// Años recomendados entre servicios, por marca (orientativo)
const SERVICE_YEARS: Record<string, number> = {
  rolex: 10, tudor: 10, omega: 8, cartier: 6, "patek philippe": 6, "audemars piguet": 6,
  "vacheron constantin": 6, "a. lange & söhne": 6, "richard mille": 5, hublot: 5, panerai: 5,
};
const DAY = 86_400_000;
const addDays = (iso: string, n: number) => new Date(new Date(`${iso}T12:00:00Z`).getTime() + n * DAY).toISOString().slice(0, 10);

type SoldItem = { id: string; brand: string; model: string | null; reference: string | null; papers_date: string | null; sale_date: string | null };

export async function scheduleAfterSale(customerId: string | null, item: SoldItem) {
  if (!customerId) return;
  const sold = item.sale_date ?? new Date().toISOString().slice(0, 10);
  const watch = [item.brand, item.model].filter(Boolean).join(" ");
  const years = SERVICE_YEARS[item.brand.toLowerCase()] ?? 5;
  // Mantenimiento: según la fecha de los papeles; si ya tocaba, a los 6 meses de la compra
  const fromPapers = item.papers_date ? addDays(item.papers_date, Math.round(years * 365.25)) : null;
  const service = fromPapers && fromPapers > addDays(sold, 180) ? fromPapers : addDays(sold, Math.max(180, Math.round(Math.min(years, 3) * 365)));
  const rows = [
    { kind: "review", due_date: addDays(sold, 7), note: watch },
    { kind: "anniversary", due_date: addDays(sold, 365), note: watch },
    { kind: "service", due_date: service, note: `${watch} · cada ~${years} años` },
  ].map((r) => ({ ...r, customer_id: customerId, item_id: item.id }));
  await adminDb().from("customer_tasks").upsert(rows, { onConflict: "customer_id,item_id,kind", ignoreDuplicates: true });
}

export type Task = { id: string; customer_id: string; item_id: string | null; kind: string; due_date: string; note: string | null };

export async function dueTasks(today: string) {
  const { data, error } = await adminDb()
    .from("customer_tasks")
    .select("id, customer_id, item_id, kind, due_date, note, customer:customers(name, phone, wa_id, lang)")
    .is("done_at", null)
    .lte("due_date", today)
    .order("due_date");
  if (error) return []; // migración pendiente
  type Row = Task & { customer: { name: string | null; phone: string | null; wa_id: string | null; lang: string | null } | null };
  return (data ?? []) as unknown as Row[];
}

// Mensaje listo para WhatsApp (en el idioma del cliente)
export function taskMessage(t: { kind: string; note: string | null }, name: string | null, lang: string | null, reviewUrl: string) {
  const first = (name ?? "").split(" ")[0];
  const watch = (t.note ?? "").split(" · ")[0];
  const es = lang !== "en";
  if (t.kind === "review")
    return es
      ? `Hola ${first}, gracias de nuevo por confiar en The Heure Society. Esperamos que esté disfrutando su ${watch}. Si tiene un minuto, su reseña nos ayudaría muchísimo${reviewUrl ? `: ${reviewUrl}` : "."}`
      : `Hi ${first}, thank you again for choosing The Heure Society. We hope you're enjoying your ${watch}. If you have a minute, a review would mean a lot to us${reviewUrl ? `: ${reviewUrl}` : "."}`;
  if (t.kind === "anniversary")
    return es
      ? `Hola ${first}, hoy hace un año de su ${watch}. Si en algún momento piensa en una nueva pieza, podemos tomar su reloj como parte del pago. ¿Le gustaría ver lo que tenemos?`
      : `Hi ${first}, it's been a year since your ${watch}. If you're ever thinking about a new piece, we can take your watch in trade. Would you like to see what we have?`;
  if (t.kind === "service")
    return es
      ? `Hola ${first}, le escribimos de The Heure Society: a su ${watch} le conviene pronto un servicio de mantenimiento. Podemos encargarnos nosotros. ¿Le interesa?`
      : `Hi ${first}, a note from The Heure Society: your ${watch} will soon be due for a service. We'd be happy to take care of it. Interested?`;
  return es ? `Hola ${first}, ¿cómo está?` : `Hi ${first}, how are you?`;
}

export const waLink = (phone: string | null, text: string) => (phone ? `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(text)}` : null);

export async function completeTask(id: string, user: string) {
  const { data } = await adminDb().from("customer_tasks").update({ done_at: new Date().toISOString(), done_by: user }).eq("id", id).is("done_at", null).select("customer_id, kind, note").maybeSingle();
  if (data) await addEvent(data.customer_id, "follow_up", `${TASK_LABEL[data.kind] ?? "Seguimiento"} · hecho${data.note ? ` (${data.note.split(" · ")[0]})` : ""}`, {}, user);
  return data;
}

export async function customerTasks(customerId: string) {
  const { data } = await adminDb().from("customer_tasks").select("*").eq("customer_id", customerId).is("done_at", null).order("due_date");
  return (data ?? []) as Task[];
}
