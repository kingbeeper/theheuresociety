import "server-only";
import { adminDb } from "./supabase";
import { customerValues, type CustomerValue } from "./customer-value";

// Base de datos de clientes vs. leads:
// · Cliente: ya hizo negocio con nosotros (nos compró, nos vendió o consignó un reloj, o está en «Ganado»).
// · Lead: todavía es un prospecto. · Dealer: tiene su propia sección (etiqueta «Dealer»).

export const isDealerTags = (tags: string[] | null | undefined) => (tags ?? []).some((t) => t.toLowerCase() === "dealer");

export async function classify() {
  const [values, { data }] = await Promise.all([customerValues(), adminDb().from("customers").select("id, stage, tags")]);
  const clients = new Set<string>();
  const dealers = new Set<string>();
  for (const c of (data ?? []) as { id: string; stage: string; tags: string[] | null }[]) {
    if (isDealerTags(c.tags)) dealers.add(c.id);
    else if (c.stage === "won" || (values.get(c.id)?.purchases ?? 0) > 0 || (values.get(c.id)?.supplied ?? 0) > 0) clients.add(c.id);
  }
  return { clients, dealers, values: values as Map<string, CustomerValue> };
}

// ¿Esta ficha es de un cliente? (para el enlace «← Clientes» / «← Leads» de la ficha)
export async function kindOf(id: string, stage: string, tags: string[] | null) {
  if (isDealerTags(tags)) return "dealer" as const;
  if (stage === "won") return "client" as const;
  const v = (await customerValues([id])).get(id);
  return v && (v.purchases > 0 || v.supplied > 0) ? ("client" as const) : ("lead" as const);
}
