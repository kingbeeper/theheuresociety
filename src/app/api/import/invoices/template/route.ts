import ExcelJS from "exceljs";
import { currentUser } from "@/lib/admin-auth";

// Plantilla de Excel para importar facturas antiguas: una fila por pieza
export async function GET() {
  if (!(await currentUser())) return new Response("Unauthorized", { status: 401 });
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Facturas");
  ws.columns = [
    { header: "Factura", key: "n", width: 12 }, { header: "Fecha", key: "d", width: 12 }, { header: "Cliente", key: "c", width: 24 }, { header: "Teléfono", key: "p", width: 16 },
    { header: "Correo", key: "e", width: 24 }, { header: "Dirección", key: "a", width: 28 }, { header: "Pieza", key: "t", width: 32 }, { header: "Detalles", key: "x", width: 30 },
    { header: "Serial", key: "s", width: 14 }, { header: "Tipo", key: "k", width: 10 }, { header: "Cantidad", key: "q", width: 9 }, { header: "Precio", key: "pr", width: 12 },
    { header: "Impuesto %", key: "tx", width: 11 }, { header: "Forma de pago", key: "m", width: 15 }, { header: "Idioma", key: "l", width: 8 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.addRow({ n: "1023", d: new Date("2025-03-14"), c: "Juan Pérez", p: "+1 305 555 1234", e: "juan@email.com", a: "Miami, FL", t: "Rolex Submariner 126610LN", x: "2021, caja y papeles", s: "7K3P9921", k: "Reloj", q: 1, pr: 14500, tx: 7, m: "Wire", l: "en" });
  ws.addRow({ n: "1024", d: new Date("2025-03-20"), c: "Ana López", p: "+1 786 555 9876", t: "Anillo de compromiso", x: "Oro 18k blanco, diamante 1.5 ct GIA, talla 6", k: "Joya", q: 1, pr: 8900, tx: 0, m: "Zelle", l: "es" });
  const buffer = await wb.xlsx.writeBuffer();
  return new Response(buffer, { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": 'attachment; filename="Plantilla importar facturas.xlsx"' } });
}
