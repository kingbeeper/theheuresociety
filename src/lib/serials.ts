import "server-only";
import { adminDb } from "./supabase";

// Historial de números de serie (tabla serial_log, la rellenan disparadores de la base de datos):
// si un reloj vuelve a entrar años después, aquí sale todo lo que pasó con él.

export const EVENT_LABEL: Record<string, string> = {
  in_purchase: "Entró por compra",
  in_consignment: "Entró en consignación",
  in_memo: "Entró en memo de dealer",
  in_trade: "Entró por intercambio",
  sold: "Vendido",
  returned: "Devuelto a su dueño",
  doc_memo: "Entregado en memo",
  doc_consignment: "Contrato de consignación",
  doc_purchase: "Contrato de compra",
  doc_invoice: "Factura",
  doc_sourcing: "Encargo",
};
// Eventos cuyo «party» es el proveedor o dueño (dato reservado al permiso «costos»)
const SUPPLIER_EVENTS = new Set(["in_purchase", "in_consignment", "in_memo", "in_trade", "returned", "doc_consignment", "doc_purchase"]);

export const normSerial = (s: string) => s.replace(/[^a-z0-9]/gi, "").toUpperCase();

export type SerialEvent = {
  event: string;
  label: string;
  event_date: string;
  party: string | null;
  watch: string | null;
  item_id: string | null;
  sku: string | null;
  document_id: string | null;
  doc_number: string | null;
  serial: string;
};

// Todo lo registrado con ese serial, del más antiguo al más reciente. `exclude` quita los registros
// del propio reloj o documento que se está editando (para no avisar de sí mismo).
export async function serialHistory(serial: string, opts: { excludeItemId?: string | null; excludeDocId?: string | null; showSuppliers?: boolean } = {}) {
  const n = normSerial(serial);
  if (n.length < 4) return [];
  const { data } = await adminDb().from("serial_log").select("*").eq("serial_norm", n).order("event_date").order("created_at");
  return ((data ?? []) as Omit<SerialEvent, "label">[])
    .filter((r) => !(opts.excludeItemId && r.item_id === opts.excludeItemId) && !(opts.excludeDocId && r.document_id === opts.excludeDocId))
    .map((r) => ({ ...r, label: EVENT_LABEL[r.event] ?? r.event, party: opts.showSuppliers === false && SUPPLIER_EVENTS.has(r.event) ? null : r.party }));
}

// Texto para Telegram
export function serialSummary(rows: SerialEvent[], serial: string) {
  if (!rows.length) return `🔎 Serial <code>${serial}</code>: no consta en el sistema.`;
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return [
    `⚠️ <b>Este reloj ya pasó por el sistema</b> · serial <code>${esc(serial)}</code>`,
    ...rows.map((r) => `• ${r.event_date} · ${r.label}${r.party ? ` · ${esc(r.party)}` : ""}${r.sku ? ` · ${esc(r.sku)}` : ""}${r.doc_number ? ` · ${esc(r.doc_number)}` : ""}${r.watch ? `\n   ${esc(r.watch)}` : ""}`),
  ].join("\n");
}
