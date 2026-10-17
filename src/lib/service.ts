import "server-only";
import { adminDb } from "./supabase";
import { docEvent, getDoc, payInvoice, toInvoice } from "./documents";
import { SERVICE_STATUS, type Doc, type ServiceOrder, type ServiceStatus } from "./doc-labels";

// Órdenes de servicio (pulido, reparación de cadenas, aretes, relojes de clientes…): la pieza entra,
// va al taller, queda lista (aviso al cliente) y al entregarla se cobra con su factura. El margen es lo
// cobrado menos lo que costó el taller.

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://theheuresociety.vercel.app").replace(/\/$/, "");
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());

export function newService(input: Partial<ServiceOrder>): ServiceOrder {
  return {
    status: "received",
    piece: input.piece ?? "",
    provider: input.provider ?? null,
    provider_cost: input.provider_cost ?? null,
    promised: input.promised ?? null,
    photos: input.photos ?? [],
    received_at: today(),
    workshop_at: null,
    ready_at: null,
    delivered_at: null,
    invoice_id: null,
  };
}

// Mensaje para el cliente cuando su pieza está lista (en el idioma del documento)
export function readyMessage(d: Doc) {
  const first = (d.client_name ?? "").split(" ")[0];
  // El trabajo («Pulido y reparación de cierre»), no la descripción interna de la pieza
  const work = d.items.map((l) => l.title).filter(Boolean).join(", ");
  const link = `${SITE}/d/${d.token}`;
  return d.lang === "es"
    ? `Hola ${first}, le avisamos de que su pieza ya está lista para recoger en nuestra oficina (169 East Flagler St, Suite 1122, Miami)${work ? `: ${work}` : ""}. Orden ${d.number}: ${link}`
    : `Hi ${first}, your piece is ready for collection at our office (169 East Flagler St, Suite 1122, Miami)${work ? `: ${work}` : ""}. Order ${d.number}: ${link}`;
}

// Avanzar la orden: al taller, lista o entregada (entregada = factura pagada con el importe de la orden)
export async function serviceStep(id: string, step: ServiceStatus, user: string, method: string | null = null) {
  const d = await getDoc(id);
  if (!d || d.kind !== "service" || !d.service) throw new Error("Orden no encontrada");
  if (d.status === "draft") throw new Error("Emite la orden antes de avanzarla");
  const s: ServiceOrder = { ...d.service, status: step };
  if (step === "workshop") s.workshop_at = today();
  if (step === "ready") s.ready_at = today();
  let invoice: Doc | null = null;
  if (step === "delivered") {
    s.delivered_at = today();
    if (Number(d.total) > 0 && !d.service.invoice_id) {
      const inv = await toInvoice(d, user);
      await adminDb().from("documents").update({ status: "sent" }).eq("id", inv.id);
      invoice = await payInvoice({ ...inv, status: "sent" }, method, today(), user);
      s.invoice_id = inv.id;
    } else {
      await adminDb().from("documents").update({ status: "converted" }).eq("id", d.id);
    }
  }
  await adminDb().from("documents").update({ service: s, updated_at: new Date().toISOString() }).eq("id", d.id);
  await docEvent(d, `servicio: ${SERVICE_STATUS[step].toLowerCase()}${step === "workshop" && s.provider ? ` (${s.provider})` : ""}`, user);
  return { doc: { ...d, service: s } as Doc, invoice };
}

// Órdenes en curso (para el CRM y Telegram)
export async function openServices() {
  const { data } = await adminDb().from("documents").select("*").eq("kind", "service").eq("status", "sent").order("created_at", { ascending: true });
  return (data ?? []) as Doc[];
}
