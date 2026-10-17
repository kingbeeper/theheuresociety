import ExcelJS from "exceljs";
import { currentUser } from "@/lib/admin-auth";
import { can } from "@/lib/crm-perms";
import { purchaseBook } from "@/lib/secondhand";

// Libro de compras de segunda mano en Excel (para una inspección): pieza, serial, vendedor e identificación
export async function GET(request: Request) {
  const user = await currentUser();
  if (!user || !can(user, "inventario")) return new Response("Unauthorized", { status: 401 });
  const url = new URL(request.url);
  const from = url.searchParams.get("desde") ?? "";
  const to = url.searchParams.get("hasta") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return new Response("Fechas no válidas", { status: 400 });
  const rows = await purchaseBook(from, to);
  const costs = can(user, "costos");
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Compras");
  ws.columns = [
    { header: "Fecha", key: "date", width: 12 }, { header: "SKU", key: "sku", width: 11 }, { header: "Pieza", key: "piece", width: 38 }, { header: "Serial", key: "serial", width: 16 },
    ...(costs ? [{ header: "Pagado (USD)", key: "paid", width: 14, style: { numFmt: '"$"#,##0.00' } }] : []),
    { header: "Vendedor", key: "seller", width: 26 }, { header: "Dirección", key: "address", width: 34 }, { header: "Teléfono", key: "phone", width: 16 },
    { header: "Identificación", key: "idType", width: 16 }, { header: "Número", key: "idNumber", width: 18 }, { header: "Nacimiento", key: "dob", width: 12 },
    { header: "Sexo", key: "sex", width: 8 }, { header: "Raza", key: "race", width: 10 }, { header: "Altura", key: "height", width: 9 }, { header: "Peso", key: "weight", width: 9 }, { header: "Pelo", key: "hair", width: 10 }, { header: "Ojos", key: "eyes", width: 10 },
    { header: "Huella", key: "thumb", width: 8 }, { header: "Contrato", key: "doc", width: 14 }, { header: "Retenida hasta", key: "hold", width: 14 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  for (const r of rows) {
    ws.addRow({
      ...r, paid: r.paid, sex: r.details?.sex, race: r.details?.race, height: r.details?.height, weight: r.details?.weight, hair: r.details?.hair, eyes: r.details?.eyes,
      thumb: r.details?.thumb_path ? "Sí" : "No", doc: r.document?.number ?? "—", hold: r.holdUntil ?? "",
    });
  }
  const buffer = await wb.xlsx.writeBuffer();
  return new Response(buffer, { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="Registro de compras ${from} a ${to}.xlsx"` } });
}
