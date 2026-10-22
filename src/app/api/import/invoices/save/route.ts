import { refresh } from "next/cache";
import { currentUser } from "@/lib/admin-auth";
import { can } from "@/lib/crm-perms";
import { saveImportedInvoice, type ImportedInvoice } from "@/lib/invoice-import";

// Guardar una factura revisada: cliente, factura pagada y piezas vendidas
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user || !can(user, "documentos")) return Response.json({ error: "Sin permiso" }, { status: 401 });
  const { invoice, file } = (await request.json()) as { invoice: ImportedInvoice; file: string | null };
  if (!invoice || !Array.isArray(invoice.items)) return Response.json({ error: "Datos no válidos" }, { status: 400 });
  const r = await saveImportedInvoice(invoice, user.email, file);
  try {
    refresh();
  } catch {}
  return Response.json(r);
}
