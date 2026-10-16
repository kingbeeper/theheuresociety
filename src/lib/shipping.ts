import "server-only";
import { adminDb } from "./supabase";
import { addEvent } from "./crm";
import { emailReady, sendEmail, simpleEmail } from "./email";
import { KIND_LABEL, type Doc } from "./doc-labels";

// Envíos: número de rastreo en un documento (factura, memo, proforma…), enlace de seguimiento de la
// paquetería y aviso al cliente (correo automático + mensaje de WhatsApp preparado) al salir y al entregarse.

export const CARRIERS = { fedex: "FedEx", ups: "UPS", usps: "USPS", dhl: "DHL", other: "Otra" } as const;
export type Carrier = keyof typeof CARRIERS;
export type Shipment = { id: string; document_id: string; carrier: Carrier; tracking: string; status: "shipped" | "delivered" | "returned"; note: string | null; shipped_at: string; delivered_at: string | null; notified: string[] };

export function trackingUrl(carrier: string, tracking: string) {
  const t = encodeURIComponent(tracking.replace(/\s+/g, ""));
  return (
    {
      fedex: `https://www.fedex.com/fedextrack/?trknbr=${t}`,
      ups: `https://www.ups.com/track?tracknum=${t}`,
      usps: `https://tools.usps.com/go/TrackConfirmAction?tLabels=${t}`,
      dhl: `https://www.dhl.com/us-en/home/tracking/tracking-express.html?submit=1&tracking-id=${t}`,
    } as Record<string, string>
  )[carrier] ?? `https://www.google.com/search?q=${t}`;
}

// La paquetería por la forma del número (si no se elige): 1Z… es UPS, 9… de 20-22 cifras USPS, 10 cifras DHL, 12/15 FedEx
export function guessCarrier(tracking: string): Carrier {
  const t = tracking.replace(/\s+/g, "").toUpperCase();
  if (/^1Z[0-9A-Z]{16}$/.test(t)) return "ups";
  if (/^9[0-9]{19,21}$/.test(t) || /^[A-Z]{2}\d{9}US$/.test(t)) return "usps";
  if (/^\d{10}$/.test(t)) return "dhl";
  if (/^\d{12}$|^\d{15}$|^\d{20}$|^\d{22}$/.test(t)) return "fedex";
  return "other";
}

// Texto para el cliente, en el idioma del documento
export function shipmentText(d: Pick<Doc, "lang" | "client_name" | "number" | "kind">, s: Pick<Shipment, "carrier" | "tracking">, what: "shipped" | "delivered") {
  const first = (d.client_name ?? "").split(" ")[0];
  const carrier = CARRIERS[s.carrier] ?? s.carrier;
  const url = trackingUrl(s.carrier, s.tracking);
  if (d.lang === "es")
    return what === "shipped"
      ? `Hola ${first}, su reloj ya va en camino 📦\nEnvío: ${carrier} · ${s.tracking}\nSeguimiento: ${url}\n(${KIND_LABEL[d.kind]} ${d.number})\nCualquier cosa, aquí estamos. — The Heure Society`
      : `Hola ${first}, el envío ${carrier} ${s.tracking} figura como entregado ✅ Esperamos que disfrute su reloj. Si necesita algo, escríbanos. — The Heure Society`;
  return what === "shipped"
    ? `Hi ${first}, your timepiece is on its way 📦\nShipment: ${carrier} · ${s.tracking}\nTrack it: ${url}\n(${d.kind === "invoice" || d.kind === "proforma" ? "Invoice" : d.kind === "memo" ? "Memo" : "Ref."} ${d.number})\nAny questions, we're here. — The Heure Society`
    : `Hi ${first}, shipment ${carrier} ${s.tracking} shows as delivered ✅ We hope you enjoy your timepiece. If you need anything, just let us know. — The Heure Society`;
}

async function emailClient(d: Doc, s: Shipment, what: "shipped" | "delivered") {
  if (!d.client_email || !emailReady()) return false;
  const es = d.lang === "es";
  const subject = what === "shipped" ? (es ? `Su reloj va en camino · ${d.number}` : `Your timepiece has shipped · ${d.number}`) : es ? `Entregado · ${d.number}` : `Delivered · ${d.number}`;
  const lines = shipmentText(d, s, what).split("\n").filter((l) => !l.startsWith("Seguimiento:") && !l.startsWith("Track it:"));
  await sendEmail(d.client_email, subject, simpleEmail([lines.join("\n")], what === "shipped" ? { label: es ? "Seguir el envío" : "Track shipment", url: trackingUrl(s.carrier, s.tracking) } : undefined));
  return true;
}

export async function shipmentsFor(documentId: string) {
  const { data } = await adminDb().from("shipments").select("*").eq("document_id", documentId).order("shipped_at", { ascending: false });
  return (data ?? []) as Shipment[];
}

export async function addShipment(d: Doc, input: { carrier?: string | null; tracking: string; note?: string | null; notify: boolean }, user: string) {
  const tracking = input.tracking.trim().replace(/\s+/g, "");
  if (!tracking) throw new Error("Falta el número de rastreo.");
  const carrier = (input.carrier && input.carrier in CARRIERS ? input.carrier : guessCarrier(tracking)) as Carrier;
  const { data, error } = await adminDb().from("shipments").insert({ document_id: d.id, carrier, tracking, note: input.note || null, created_by: user }).select("*").single();
  if (error) throw error;
  const s = data as Shipment;
  let emailed = false;
  if (input.notify) emailed = await emailClient(d, s, "shipped").catch(() => false);
  if (emailed) await adminDb().from("shipments").update({ notified: ["shipped"] }).eq("id", s.id);
  if (d.customer_id) await addEvent(d.customer_id, "shipment", `📦 Enviado por ${CARRIERS[carrier]} · ${tracking} (${KIND_LABEL[d.kind]} ${d.number})${emailed ? " · aviso por correo" : ""}`, { document: d.id }, user);
  return { shipment: s, emailed };
}

export async function markDelivered(id: string, notify: boolean, user: string) {
  const db = adminDb();
  const { data: s } = await db.from("shipments").update({ status: "delivered", delivered_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", id).select("*").single();
  if (!s) return null;
  const { data: d } = await db.from("documents").select("*").eq("id", s.document_id).single();
  let emailed = false;
  if (d && notify && !(s.notified ?? []).includes("delivered")) emailed = await emailClient(d as Doc, s as Shipment, "delivered").catch(() => false);
  if (emailed) await db.from("shipments").update({ notified: [...(s.notified ?? []), "delivered"] }).eq("id", id);
  if (d?.customer_id) await addEvent(d.customer_id, "shipment", `✅ Entregado: ${CARRIERS[s.carrier as Carrier] ?? s.carrier} · ${s.tracking}${emailed ? " · aviso por correo" : ""}`, { document: d.id }, user);
  return { shipment: s as Shipment, doc: d as Doc | null, emailed };
}

export async function deleteShipment(id: string) {
  await adminDb().from("shipments").delete().eq("id", id);
}
