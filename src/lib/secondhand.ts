import "server-only";
import { adminDb } from "./supabase";

// Compras de segunda mano (Florida, cap. 538). Lo que se compra a un particular (no a un dealer) queda
// retenido X días desde la compra (15 por defecto: «Inventario → Registro de compras») y no se puede vender
// antes. El contrato de compra guarda los datos del vendedor y el libro se exporta a Excel.
// Los plazos y datos exactos conviene confirmarlos con el abogado y la policía local.

const HOLD_KEY = "secondhand_hold_days";
export const DEFAULT_HOLD_DAYS = 15;

export async function holdDays() {
  const { data } = await adminDb().from("integration_settings").select("value").eq("key", HOLD_KEY).maybeSingle();
  const n = Number(data?.value);
  return data && Number.isFinite(n) && n >= 0 ? n : DEFAULT_HOLD_DAYS;
}
export const setHoldDays = (n: number) =>
  adminDb().from("integration_settings").upsert({ key: HOLD_KEY, value: String(Math.max(0, Math.min(60, Math.round(n)))), updated_at: new Date().toISOString() }, { onConflict: "key" });

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export const miamiToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());

// ¿Hasta cuándo queda retenida una pieza que entra? Solo compras e intercambios a particulares
// secondhand: true/false si se marcó a mano en el formulario; sin indicar, se decide solo (un proveedor
// con empresa o un dealer no es un particular: no hay retención)
export async function holdUntil(fields: { acquisition?: unknown; purchase_date?: unknown; supplier_customer_id?: unknown; supplier_company?: unknown }, secondhand?: boolean) {
  if (fields.acquisition !== "purchase" && fields.acquisition !== "trade") return null;
  if (secondhand === false) return null;
  const days = await holdDays();
  if (!days) return null;
  if (secondhand === undefined && typeof fields.supplier_company === "string" && fields.supplier_company.trim()) return null;
  if (secondhand === undefined && fields.supplier_customer_id) {
    const { data } = await adminDb().from("customers").select("tags").eq("id", fields.supplier_customer_id as string).maybeSingle();
    if (((data?.tags ?? []) as string[]).some((t) => t.toLowerCase() === "dealer")) return null; // a un dealer: no aplica
  }
  return addDays((fields.purchase_date as string | null) ?? miamiToday(), days);
}

// Mensaje si alguna de estas piezas sigue en retención (o null si se pueden vender)
export async function holdBlock(itemIds: (string | null | undefined)[]) {
  const ids = itemIds.filter(Boolean) as string[];
  if (!ids.length) return null;
  const { data } = await adminDb().from("inventory_items").select("sku, hold_until").in("id", ids).gt("hold_until", miamiToday());
  if (!data?.length) return null;
  return data.map((i) => `${i.sku}: en retención hasta el ${i.hold_until}`).join(" · ") + " (compra de segunda mano: no se puede vender antes).";
}

import type { SellerDetails } from "./doc-labels";
export type { SellerDetails };

// Libro de compras: cada pieza comprada o recibida en intercambio, con su vendedor y su contrato
export async function purchaseBook(from: string, to: string) {
  const db = adminDb();
  const { data: items } = await db
    .from("inventory_items")
    .select("id, sku, category, brand, model, reference, serial, purchase_date, cost, acquisition, supplier_name, supplier_customer_id, hold_until, status")
    .in("acquisition", ["purchase", "trade"])
    .gte("purchase_date", from)
    .lte("purchase_date", to)
    .order("purchase_date", { ascending: false });
  const list = items ?? [];
  // Contrato de compra de cada pieza (datos del vendedor)
  const { data: docs } = list.length
    ? await db.from("documents").select("id, number, items, client_name, client_address, client_phone, seller_id_type, seller_id_number, seller_dob, seller_details, issue_date, id_photo_path, signed_at, photos").eq("kind", "purchase").neq("status", "void")
    : { data: [] };
  const docFor = (id: string) => (docs ?? []).find((d) => ((d.items ?? []) as { item_id?: string }[]).some((l) => l.item_id === id));
  return list.map((i) => {
    const d = docFor(i.id as string);
    const sd = (d?.seller_details ?? null) as SellerDetails | null;
    return {
      id: i.id as string,
      date: i.purchase_date as string | null,
      sku: i.sku as string,
      piece: [i.brand, i.model, i.reference].filter(Boolean).join(" "),
      serial: i.serial as string | null,
      paid: i.cost != null ? Number(i.cost) : null,
      acquisition: i.acquisition as string,
      seller: (d?.client_name as string | null) ?? (i.supplier_name as string | null),
      address: (d?.client_address as string | null) ?? sd?.address ?? null,
      phone: (d?.client_phone as string | null) ?? null,
      idType: (d?.seller_id_type as string | null) ?? null,
      idNumber: (d?.seller_id_number as string | null) ?? null,
      dob: (d?.seller_dob as string | null) ?? null,
      details: sd,
      document: d ? { id: d.id as string, number: d.number as string, signed: Boolean(d.signed_at), idPhoto: Boolean(d.id_photo_path), photos: ((d.photos ?? []) as string[]).length } : null,
      holdUntil: i.hold_until as string | null,
      status: i.status as string,
    };
  });
}
