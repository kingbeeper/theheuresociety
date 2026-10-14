import { currentUser } from "@/lib/admin-auth";
import { can } from "@/lib/crm-perms";
import { serialHistory } from "@/lib/serials";

// Historial de un número de serie para el aviso del CRM (al escribir el serial de un reloj)
export async function GET(request: Request) {
  const user = await currentUser();
  if (!user || !(can(user, "inventario") || can(user, "documentos") || can(user, "compras"))) return new Response("Unauthorized", { status: 401 });
  const url = new URL(request.url);
  const rows = await serialHistory(url.searchParams.get("s") ?? "", {
    excludeItemId: url.searchParams.get("item"),
    excludeDocId: url.searchParams.get("doc"),
    showSuppliers: can(user, "costos"),
  });
  return Response.json({ rows }, { headers: { "Cache-Control": "no-store" } });
}
