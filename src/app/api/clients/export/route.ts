import { adminEmail } from "@/lib/admin-auth";
import { adminDb } from "@/lib/supabase";
import { classify } from "@/lib/clients";
import { REGIONS, isRegion, regionOf } from "@/lib/regions";
import { lastAddresses } from "@/lib/region-data";

// Exporta los clientes (todos o de una región) a CSV: para listas de difusión de WhatsApp, correos, etc.
export async function GET(request: Request) {
  if (!(await adminEmail("leads"))) return new Response("Unauthorized", { status: 401 });
  const want = new URL(request.url).searchParams.get("region") ?? "";
  const [{ clients }, { data }, addresses] = await Promise.all([classify(), adminDb().from("customers").select("id, name, phone, email, region, tags, lang, email_opt_out").limit(5000), lastAddresses()]);
  const rows = (data ?? [])
    .filter((c) => clients.has(c.id as string))
    .map((c) => ({ ...c, r: regionOf(c as { region: string | null; phone: string | null }, addresses.get(c.id as string)).region }))
    .filter((c) => !want || (want === "sin" ? !c.r : isRegion(want) && c.r === want));
  const cell = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    ["Nombre", "Teléfono", "Correo", "Región", "Etiquetas", "Idioma", "Baja de correos"].join(","),
    ...rows.map((c) => [c.name, c.phone, c.email, c.r ? REGIONS[c.r].replace(/^\S+\s/, "") : "", ((c.tags ?? []) as string[]).join(" "), c.lang, c.email_opt_out ? "sí" : ""].map(cell).join(",")),
  ];
  return new Response(`\uFEFF${lines.join("\r\n")}`, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="clientes${want ? `-${want}` : ""}.csv"` },
  });
}
