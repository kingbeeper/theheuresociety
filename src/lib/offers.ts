import "server-only";
import { adminDb, PHOTO_BUCKET } from "./supabase";
import { upsertLead } from "./crm";

// Ofertas de clientes (tabla sell_requests): relojes que nos ofrecen para comprar, intercambiar o consignar.
// Llegan solas de la web, WhatsApp e Instagram/Facebook; esto es para registrarlas a mano (CRM o Telegram).

export const OFFER_KIND = { sell: "Venta", trade: "Intercambio", consign: "Consignación" } as const;
export type OfferKind = keyof typeof OFFER_KIND;

export type OfferInput = {
  kind: OfferKind;
  name: string;
  phone?: string | null;
  email?: string | null;
  brand: string;
  model?: string | null;
  reference?: string | null;
  asking?: string | null; // lo que pide el cliente (texto libre: «18k», «$18,000»)
  details?: string | null;
  photos?: { type: string }[];
};

export async function createOffer(o: OfferInput, user: string, source = "walk_in") {
  const db = adminDb();
  const watch = [o.brand, o.model, o.reference].map((x) => x?.trim()).filter(Boolean).join(" ");
  const customer = await upsertLead({
    name: o.name.trim(),
    phone: o.phone?.trim() || null,
    email: o.email?.trim() || null,
    source,
    intent: o.kind,
    stage: "qualified",
    notify: false,
    event: { type: "sell_request", body: `${{ sell: "Vende", trade: "Intercambia", consign: "Consigna" }[o.kind]}: ${watch}` },
  });
  const id = crypto.randomUUID();
  const bucket = db.storage.from(PHOTO_BUCKET);
  const uploads = (
    await Promise.all(
      (o.photos ?? []).slice(0, 10).map(async (p, i) => {
        const ext = p.type.includes("png") ? "png" : p.type.includes("webp") ? "webp" : "jpg";
        const path = `leads/${id}/${i + 1}.${ext}`;
        const { data } = await bucket.createSignedUploadUrl(path);
        return data ? { url: data.signedUrl, publicUrl: bucket.getPublicUrl(path).data.publicUrl } : null;
      })
    )
  ).filter((u): u is NonNullable<typeof u> => Boolean(u));
  const message = [o.asking?.trim() && `Pide: ${o.asking.trim()}`, o.details?.trim()].filter(Boolean).join("\n") || null;
  const { error } = await db.from("sell_requests").insert({
    id,
    kind: o.kind,
    name: o.name.trim(),
    phone: customer.phone,
    email: customer.email,
    brand: o.brand.trim(),
    model: o.model?.trim() || null,
    reference: o.reference?.trim() || null,
    message,
    image_paths: [],
    customer_id: customer.id,
    notes: `Registrada a mano por ${user}`,
  });
  if (error) return { error: error.message };
  return { ok: true as const, id, customerId: customer.id, uploads };
}
