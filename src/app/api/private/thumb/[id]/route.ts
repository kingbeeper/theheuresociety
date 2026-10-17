import { adminEmail } from "@/lib/admin-auth";
import { adminDb } from "@/lib/supabase";
import { privateUrl } from "@/lib/private-files";

// Foto de la huella del vendedor de un contrato de compra (solo usuarios con «documentos»)
export async function GET(_: Request, { params }: RouteContext<"/api/private/thumb/[id]">) {
  if (!(await adminEmail("documentos"))) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  const { data } = await adminDb().from("documents").select("seller_details").eq("id", id).maybeSingle();
  const path = (data?.seller_details as { thumb_path?: string | null } | null)?.thumb_path;
  const url = path ? await privateUrl(path, 60) : null;
  if (!url) return new Response("No hay huella", { status: 404 });
  return Response.redirect(url, 302);
}
