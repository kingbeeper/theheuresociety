import { adminEmail } from "@/lib/admin-auth";
import { monthlyPdf } from "@/lib/monthly-pdf";

// Informe del mes en PDF para el dueño (ventas, ganancia real, cobros, clientes, inventario, redes)
export async function GET(request: Request) {
  if (!(await adminEmail("informes"))) return new Response("Unauthorized", { status: 401 });
  const url = new URL(request.url);
  const month = url.searchParams.get("mes") ?? "";
  if (!/^\d{4}-\d{2}$/.test(month)) return new Response("Mes no válido (AAAA-MM)", { status: 400 });
  const { bytes, filename } = await monthlyPdf(month, url.searchParams.get("lang") === "en" ? "en" : "es");
  return new Response(Buffer.from(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${filename}"` } });
}
