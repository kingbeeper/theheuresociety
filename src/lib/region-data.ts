import "server-only";
import { adminDb } from "./supabase";

// Última dirección conocida de cada cliente (de sus documentos), para sugerir la región
export async function lastAddresses() {
  const { data } = await adminDb().from("documents").select("customer_id, client_address, issue_date").not("client_address", "is", null).not("customer_id", "is", null).order("issue_date", { ascending: false }).limit(5000);
  const out = new Map<string, string>();
  for (const d of data ?? []) if (!out.has(d.customer_id as string)) out.set(d.customer_id as string, d.client_address as string);
  return out;
}
