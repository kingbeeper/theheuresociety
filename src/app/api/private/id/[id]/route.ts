import { adminEmail } from "@/lib/admin-auth";
import { adminDb } from "@/lib/supabase";
import { privateUrl } from "@/lib/private-files";

// Foto de la identificación del vendedor de un contrato de compra (solo usuarios con «documentos»)
export async function GET(_: Request, { params }: RouteContext<"/api/private/id/[id]">) {
  if (!(await adminEmail("documentos"))) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  const { data } = await adminDb().from("documents").select("id_photo_path").eq("id", id).maybeSingle();
  const url = data?.id_photo_path ? await privateUrl(data.id_photo_path, 60) : null;
  if (!url) return new Response("No hay foto", { status: 404 });
  return Response.redirect(url, 302);
}
