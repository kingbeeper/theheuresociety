import { adminDb } from "@/lib/supabase";
import { getDocSettings } from "@/lib/documents";
import { certItems, renderCertificates } from "@/lib/certificate";
import type { Doc } from "@/lib/doc-labels";

// Certificados de autenticidad de los relojes de una factura (mismo enlace privado del cliente)
export async function GET(_: Request, { params }: RouteContext<"/d/[token]/certificate">) {
  const { token } = await params;
  if (!/^[\w-]{20,40}$/.test(token)) return new Response("No encontrado", { status: 404 });
  const { data } = await adminDb().from("documents").select("*").eq("token", token).maybeSingle();
  const d = data as Doc | null;
  if (!d || d.kind !== "invoice" || (d.status !== "sent" && d.status !== "paid")) return new Response("No encontrado", { status: 404 });
  const items = await certItems(d.items.map((l) => l.item_id).filter(Boolean) as string[], d.client_name);
  if (!items.length) return new Response("Esta factura no tiene relojes del inventario", { status: 404 });
  const bytes = await renderCertificates(items, d.lang, await getDocSettings());
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="Certificate ${d.number}.pdf"`,
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
