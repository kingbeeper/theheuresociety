import { currentUser } from "@/lib/admin-auth";
import { can } from "@/lib/crm-perms";
import { readInvoiceFile, readInvoiceSheet } from "@/lib/invoice-import";

// Leer facturas antiguas (PDF, foto o Excel con la plantilla) para revisarlas antes de importarlas
export const maxDuration = 300;

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user || !can(user, "documentos")) return Response.json({ error: "Sin permiso" }, { status: 401 });
  const form = await request.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File).slice(0, 20);
  const out: { file: string; invoices?: unknown[]; error?: string }[] = [];
  for (const f of files) {
    try {
      const buf = await f.arrayBuffer();
      if (/\.xlsx$/i.test(f.name) || f.type.includes("spreadsheet")) {
        out.push({ file: f.name, invoices: await readInvoiceSheet(buf) });
      } else if (f.type === "application/pdf" || f.type.startsWith("image/")) {
        if (buf.byteLength > 4_000_000) {
          out.push({ file: f.name, error: "El archivo pesa más de 4 MB." });
          continue;
        }
        const inv = await readInvoiceFile(Buffer.from(buf).toString("base64"), f.type);
        out.push(inv ? { file: f.name, invoices: [inv] } : { file: f.name, error: "No se pudo leer la factura." });
      } else {
        out.push({ file: f.name, error: "Formato no admitido (PDF, foto o Excel .xlsx)." });
      }
    } catch (e) {
      out.push({ file: f.name, error: (e as Error).message.slice(0, 200) });
    }
  }
  return Response.json({ results: out });
}
