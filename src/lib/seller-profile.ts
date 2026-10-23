import "server-only";
import { adminDb } from "./supabase";
import type { SellerDetails } from "./doc-labels";

// Datos del vendedor de su último contrato de compra (identificación, foto del ID, nacimiento y los del
// registro de segunda mano), para no volver a pedirlos si ya nos vendió antes
export type SellerProfile = { number: string; idType: string | null; idNumber: string | null; dob: string | null; idPhoto: string | null; details: SellerDetails | null; address: string | null };

export async function lastSellerProfile(customerId: string | null | undefined): Promise<SellerProfile | null> {
  if (!customerId) return null;
  const { data } = await adminDb()
    .from("documents")
    .select("number, seller_id_type, seller_id_number, seller_dob, id_photo_path, seller_details, client_address, issue_date")
    .eq("customer_id", customerId)
    .eq("kind", "purchase")
    .neq("status", "void")
    .order("issue_date", { ascending: false })
    .limit(10);
  const d = (data ?? []).find((x) => x.seller_id_number || x.id_photo_path);
  if (!d) return null;
  return {
    number: d.number as string,
    idType: d.seller_id_type as string | null,
    idNumber: d.seller_id_number as string | null,
    dob: d.seller_dob as string | null,
    idPhoto: d.id_photo_path as string | null,
    details: (d.seller_details ?? null) as SellerDetails | null,
    address: d.client_address as string | null,
  };
}

// Lo que ve el formulario del CRM (sin la ruta de la foto del ID)
export type SellerPrefill = SellerProfile & { hasIdPhoto: boolean };

// Completa los datos del vendedor con los de su contrato de compra anterior (lo que se deja vacío se hereda;
// si escribe otro número de ID, se toma como una identificación nueva y no se copia nada)
export async function inheritSeller(customerId: string | null | undefined, f: { idType?: string | null; idNumber?: string | null; dob?: string | null; address?: string | null; details?: SellerDetails }) {
  const prev = await lastSellerProfile(customerId);
  const same = prev && (!f.idNumber || f.idNumber === prev.idNumber);
  if (!prev || !same) return { ...f, idPhoto: null as string | null, from: null as string | null };
  const details = { ...f.details } as Record<string, string | null | undefined>;
  for (const [k, v] of Object.entries(prev.details ?? {})) if (!details[k] && v) details[k] = v as string;
  return {
    idType: f.idType ?? prev.idType,
    idNumber: f.idNumber ?? prev.idNumber,
    dob: f.dob ?? prev.dob,
    address: f.address ?? prev.address,
    details: details as SellerDetails,
    idPhoto: prev.idPhoto,
    from: prev.number,
  };
}
