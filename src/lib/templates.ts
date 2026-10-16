import "server-only";
import { adminDb } from "./supabase";

// Respuestas rápidas de WhatsApp: plantillas en español e inglés con huecos que se rellenan solos:
// {nombre} (nombre del cliente), {reloj}, {precio}, {enlace} (la ficha del reloj en la web) y {pago}
// (los datos de pago de Documentos → Ajustes). Se editan en CRM → Leads → Respuestas rápidas.

export type Template = { id: string | null; title: string; body_es: string; body_en: string; sort: number };

export const DEFAULT_TEMPLATES: Omit<Template, "id">[] = [
  {
    title: "Precio y disponibilidad",
    body_es: "Hola {nombre}, gracias por escribirnos. El {reloj} está disponible por {precio}. ¿Le gustaría verlo en persona o prefiere que le enviemos más fotos y un video?",
    body_en: "Hi {nombre}, thank you for reaching out. The {reloj} is available for {precio}. Would you like to see it in person, or shall we send you more photos and a video?",
    sort: 1,
  },
  {
    title: "Fotos y ficha del reloj",
    body_es: "Hola {nombre}, aquí tiene las fotos y los detalles del {reloj}: {enlace}\nCualquier pregunta, con gusto se la respondemos.",
    body_en: "Hi {nombre}, here are the photos and details of the {reloj}: {enlace}\nHappy to answer any questions.",
    sort: 2,
  },
  {
    title: "Confirmar cita",
    body_es: "Hola {nombre}, le confirmamos su cita en nuestra oficina: 169 East Flagler St, Suite 1122, Miami. Le esperamos. Si necesita cambiar la hora, escríbanos por aquí.",
    body_en: "Hi {nombre}, we're confirming your appointment at our office: 169 East Flagler St, Suite 1122, Miami. We look forward to seeing you. If you need to change the time, just message us here.",
    sort: 3,
  },
  {
    title: "Datos de pago",
    body_es: "Hola {nombre}, estos son los datos para el pago del {reloj} ({precio}):\n{pago}\nEn cuanto lo recibamos le enviamos la factura.",
    body_en: "Hi {nombre}, here are the payment details for the {reloj} ({precio}):\n{pago}\nAs soon as we receive it we'll send you the invoice.",
    sort: 4,
  },
  {
    title: "Seguimiento",
    body_es: "Hola {nombre}, ¿pudo pensar en el {reloj}? Si tiene alguna duda o quiere ver otras opciones, aquí estamos.",
    body_en: "Hi {nombre}, have you had a chance to think about the {reloj}? If you have any questions or would like to see other options, we're here.",
    sort: 5,
  },
  {
    title: "Ya se vendió: buscamos otro",
    body_es: "Hola {nombre}, el {reloj} acaba de venderse, pero podemos conseguirle uno igual o parecido. ¿Quiere que le avisemos en cuanto tengamos otro?",
    body_en: "Hi {nombre}, the {reloj} has just been sold, but we can source the same or a similar piece for you. Shall we let you know as soon as we have another one?",
    sort: 6,
  },
];

export async function templates(): Promise<Template[]> {
  const { data, error } = await adminDb().from("message_templates").select("*").order("sort").order("created_at");
  if (error || !data?.length) return DEFAULT_TEMPLATES.map((t) => ({ ...t, id: null }));
  return data as Template[];
}

// Primera vez que se edita: se guardan las de serie en la base para poder cambiarlas
export async function ensureTemplates() {
  const db = adminDb();
  const { count } = await db.from("message_templates").select("id", { count: "exact", head: true });
  if (!count) await db.from("message_templates").insert(DEFAULT_TEMPLATES);
}

export function fillTemplate(body: string, vars: Record<string, string | null | undefined>) {
  return body.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] ?? "").trim() || m).replace(/\n{3,}/g, "\n\n");
}
