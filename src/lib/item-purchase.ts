import "server-only";
import { adminDb } from "./supabase";
import { upsertLead } from "./crm";
import { getDocSettings, insertDoc, issueDoc } from "./documents";
import { termsFor, type SellerDetails } from "./doc-labels";
import { lineDetails } from "./stock-labels";
import { itemPhotos } from "./item-photos";
import { inheritSeller } from "./seller-profile";

export type SellerInput = {
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  idType: string | null;
  idNumber: string | null;
  dob: string | null;
  details: SellerDetails;
  idPhoto: string | null;
};

// Al dar de alta una compra a un particular desde el inventario: el vendedor queda como cliente y se crea su
// contrato de compra (con su identificación y los datos del registro de segunda mano de Florida), firmado por
// la tienda y pendiente de su firma. El registro de compras lo recoge de ahí.
export async function createPurchaseContract(itemId: string, s: SellerInput, user: string) {
  const db = adminDb();
  const { data: item } = await db.from("inventory_items").select("id, sku, category, brand, model, reference, serial, cost, condition, comes_with, papers_date, description, jewelry").eq("id", itemId).single();
  if (!item) return null;
  const customer = await upsertLead({ name: s.name, phone: s.phone, email: s.email, source: "walk_in", intent: "sell", notify: false });
  const merged = await inheritSeller(customer.id, { idType: s.idType, idNumber: s.idNumber, dob: s.dob, address: s.address, details: s.details });
  const today = new Date().toISOString().slice(0, 10);
  const settings = await getDocSettings();
  const doc = await insertDoc({
    kind: "purchase",
    customer_id: customer.id,
    client_name: s.name,
    client_email: customer.email ?? s.email,
    client_phone: customer.phone ?? s.phone,
    client_address: merged.address ?? null,
    lang: "en",
    issue_date: today,
    due_date: null,
    seller_id_type: merged.idType ?? null,
    seller_id_number: merged.idNumber ?? null,
    seller_dob: merged.dob ?? null,
    seller_details: { ...merged.details, address: merged.address ?? null } as SellerDetails,
    id_photo_path: s.idPhoto ?? merged.idPhoto ?? null,
    photos: await itemPhotos([itemId]),
    items: [{
      item_id: item.id as string,
      sku: item.sku as string,
      title: [item.brand, item.model, item.reference].filter(Boolean).join(" "),
      details: lineDetails(item as never) || null,
      serial: item.serial as string | null,
      qty: 1,
      price: Number(item.cost ?? 0),
    }],
    tax_rate: 0,
    show_serial: true,
    payment_method: null,
    terms: termsFor("purchase", "en", settings),
    created_by: user,
  });
  await issueDoc(doc, user);
  await db.from("inventory_items").update({ supplier_customer_id: customer.id }).eq("id", itemId);
  return { doc, from: merged.from };
}
