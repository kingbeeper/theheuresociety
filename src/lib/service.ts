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

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);

// Recordatorio para recoger una pieza que lleva días lista
export function pickupMessage(d: Doc, days: number) {
  const first = (d.client_name ?? "").split(" ")[0];
  return d.lang === "es"
    ? `Hola ${first}, le recordamos que su pieza está lista desde hace ${days} día(s) en nuestra oficina (169 East Flagler St, Suite 1122, Miami). Cuando le venga bien, pase a recogerla o díganos y coordinamos la entrega. Orden ${d.number}: ${SITE}/d/${d.token}`
    : `Hi ${first}, a friendly reminder that your piece has been ready for ${days} day(s) at our office (169 East Flagler St, Suite 1122, Miami). Stop by whenever it suits you, or let us know and we'll arrange delivery. Order ${d.number}: ${SITE}/d/${d.token}`;
}

// Panel de servicios: en curso, listas sin recoger, atrasadas y números por taller (últimos 90 días)
export async function serviceBoard() {
  const t = today();
  const open = await openServices();
  const waiting = open
    .filter((d) => d.service?.status === "ready" && d.service.ready_at)
    .map((d) => ({ d, days: daysBetween(d.service!.ready_at!, t) }))
    .sort((a, b) => b.days - a.days);
  const late = open.filter((d) => d.service && d.service.status !== "ready" && d.due_date && d.due_date < t);
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const { data } = await adminDb().from("documents").select("*").eq("kind", "service").neq("status", "void").neq("status", "draft").gte("created_at", since);
  const byShop = new Map<string, { count: number; done: number; days: number[]; revenue: number; cost: number }>();
  for (const d of (data ?? []) as Doc[]) {
    const s = d.service;
    if (!s) continue;
    const k = s.provider || "—";
    const row = byShop.get(k) ?? { count: 0, done: 0, days: [], revenue: 0, cost: 0 };
    row.count++;
    if (s.ready_at && s.received_at) row.days.push(daysBetween(s.received_at, s.ready_at));
    if (s.status === "delivered") {
      row.done++;
      row.revenue += Number(d.subtotal ?? 0) - Number(d.discount ?? 0);
      row.cost += Number(s.provider_cost ?? 0);
    }
    byShop.set(k, row);
  }
  const shops = [...byShop.entries()].map(([name, r]) => ({ name, ...r, avgDays: r.days.length ? r.days.reduce((a, n) => a + n, 0) / r.days.length : null })).sort((a, b) => b.count - a.count);
  return { open, waiting, late, shops };
}

// Para el resumen de la mañana: piezas listas sin recoger (7+ días) y órdenes atrasadas
export async function servicesDigest() {
  const { waiting, late } = await serviceBoard();
  const stale = waiting.filter((w) => w.days >= 7);
  if (!stale.length && !late.length) return null;
  return {
    text: [
      stale.length ? `🔧 <b>Piezas listas sin recoger</b> (${stale.length})` : "",
      ...stale.slice(0, 6).map((w) => `• ${w.d.number} · ${w.d.client_name ?? ""} · ${w.days} día(s)`),
      late.length ? `${stale.length ? "\n" : ""}⏰ <b>Servicios atrasados</b> (${late.length}): ${late.slice(0, 6).map((d) => `${d.number} (${d.service?.provider ?? "taller"})`).join(", ")}` : "",
    ].filter(Boolean).join("\n"),
    buttons: stale.slice(0, 5).filter((w) => w.d.client_phone).map((w) => ({ text: `📲 Recordar a ${(w.d.client_name ?? "cliente").split(" ")[0]} (${w.d.number})`.slice(0, 60), url: `https://wa.me/${w.d.client_phone!.replace(/\D/g, "")}?text=${encodeURIComponent(pickupMessage(w.d, w.days))}` })),
  };
}
