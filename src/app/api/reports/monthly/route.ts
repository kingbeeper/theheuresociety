import ExcelJS from "exceljs";
import { adminEmail } from "@/lib/admin-auth";
import { monthlyReport } from "@/lib/report";
import { monthlyCommissions } from "@/lib/team";

// Informe mensual en Excel (una hoja por apartado) para el contador
export async function GET(request: Request) {
  if (!(await adminEmail("informes"))) return new Response("Unauthorized", { status: 401 });
  const month = new URL(request.url).searchParams.get("mes") ?? "";
  if (!/^\d{4}-\d{2}$/.test(month)) return new Response("Mes no válido (AAAA-MM)", { status: 400 });
  const r = await monthlyReport(month);

  const wb = new ExcelJS.Workbook();
  wb.creator = "The Heure Society CRM";
  const usd = '"$"#,##0.00';
  const sheet = (name: string, columns: [string, string, number, boolean?][], rows: Record<string, unknown>[]) => {
    const ws = wb.addWorksheet(name);
    ws.columns = columns.map(([header, key, width, money]) => ({ header, key, width, style: money ? { numFmt: usd } : {} }));
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: "frozen", ySplit: 1 }];
    rows.forEach((row) => ws.addRow(row));
    return ws;
  };

  const t = r.totals;
  const summary = sheet("Resumen", [["Concepto", "k", 42], ["Importe", "v", 18, true]], [
    { k: "Ventas (relojes, joyería y servicios)", v: t.revenue },
    { k: "· Relojes", v: t.revenueWatches },
    { k: "· Joyería y otros", v: t.revenueJewelry },
    { k: "· Servicios (pulido, reparación)", v: t.services },
    { k: "Costo de lo vendido (costo + gastos)", v: t.cogs },
    { k: "Ganancia bruta", v: t.profit },
    { k: "Compras de stock propio", v: t.bought },
    { k: "Pagado a dueños (consignación y memo)", v: t.ownerPaid },
    { k: "Gastos de relojero", v: t.repairs },
    { k: "Gastos generales del negocio", v: t.businessExpenses },
    { k: "Ganancia real (ganancia bruta − gastos generales)", v: t.profit - t.businessExpenses },
    { k: "Ventas con impuesto (base imponible)", v: t.taxableSales },
    { k: "Ventas exentas (facturas sin impuesto)", v: t.exemptSales },
    { k: "Impuesto de ventas cobrado", v: t.taxCollected },
    { k: "Depósitos y anticipos recibidos en el mes (encargos y proformas; no son ventas)", v: t.depositsReceived },
    { k: "Anticipos retenidos hoy (pasivo: se devuelven si no se consigue)", v: t.depositsHeld },
  ]);
  summary.insertRow(1, [`The Heure Society · Informe de ${month}`]);
  summary.getRow(1).font = { bold: true, size: 14 };

  sheet("Ventas", [["Fecha", "date", 12], ["SKU", "sku", 11], ["Tipo", "kind", 10], ["Pieza", "watch", 40], ["Serie", "serial", 16], ["Entrada", "acquisition", 16], ["Comprador", "buyer", 24], ["Pago", "payment", 14], ["Venta", "price", 14, true], ["Costo", "cost", 14, true], ["Gastos", "extra", 12, true], ["Ganancia", "profit", 14, true]], r.sales.map((x) => ({ ...x, kind: x.category === "jewelry" ? "Joya" : x.category === "other" ? "Otro" : "Reloj" })));
  sheet("Servicios", [["Fecha", "date", 12], ["Orden", "number", 14], ["Cliente", "client", 26], ["Trabajo", "work", 40], ["Cobrado", "price", 14, true], ["Taller", "cost", 14, true], ["Ganancia", "profit", 14, true]], r.serviceOrders);
  sheet("Compras", [["Fecha", "date", 12], ["SKU", "sku", 11], ["Reloj", "watch", 40], ["Serie", "serial", 16], ["Entrada", "acquisition", 18], ["Proveedor", "supplier", 30], ["Pagado", "cost", 14, true]], r.purchases);
  sheet("Pagos a dueños", [["Fecha", "date", 12], ["SKU", "sku", 11], ["Reloj", "watch", 36], ["Dueño", "owner", 28], ["Importe", "amount", 14, true]], r.owners);
  sheet("Impuesto de ventas", [["Fecha de pago", "date", 14], ["Factura", "number", 16], ["Cliente", "client", 28], ["Base", "taxable", 14, true], ["%", "rate", 6], ["Impuesto", "tax", 14, true], ["Total", "total", 14, true]], r.taxes);
  sheet("Relojero", [["Fecha", "date", 12], ["SKU", "sku", 11], ["Reloj", "watch", 34], ["Relojero", "provider", 24], ["Trabajo", "work", 24], ["Costo", "cost", 14, true]], r.repairs);

  sheet("Gastos del negocio", [["Fecha", "date", 12], ["Categoría", "category", 26], ["Detalle", "note", 40], ["Importe", "amount", 14, true]], r.business);
  sheet("Anticipos (pasivo)", [["Fecha", "date", 12], ["Documento", "number", 14], ["Cliente", "client", 26], ["Reloj buscado", "watch", 36], ["Pago", "method", 14], ["Anticipo", "amount", 14, true], ["Estado", "state", 22]], r.deposits);

  const commissions = await monthlyCommissions(month);
  sheet(
    "Comisiones",
    [["Vendedor", "seller", 28], ["Reloj", "watch", 36], ["SKU", "sku", 11], ["Fecha", "date", 12], ["Venta", "price", 14, true], ["Comisión", "commission", 14, true]],
    commissions.flatMap((c) => c.sales.map((s) => ({ seller: c.member.name ?? c.member.email, ...s })))
  );

  const buffer = await wb.xlsx.writeBuffer();
  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="THS-informe-${month}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
