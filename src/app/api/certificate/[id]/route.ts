import { adminEmail } from "@/lib/admin-auth";
import { getDocSettings } from "@/lib/documents";
import { certItems, renderCertificates } from "@/lib/certificate";

// Certificado de un reloj del inventario (desde el CRM)
export async function GET(request: Request, { params }: RouteContext<"/api/certificate/[id]">) {
  if (!(await adminEmail())) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  const lang = new URL(request.url).searchParams.get("lang") === "es" ? "es" : "en";
  const items = await certItems([id], null);
  if (!items.length) return new Response("No encontrado", { status: 404 });
  const bytes = await renderCertificates(items, lang, await getDocSettings());
  return new Response(Buffer.from(bytes), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="Certificate ${items[0].sku}.pdf"`, "Cache-Control": "no-store" },
  });
}
