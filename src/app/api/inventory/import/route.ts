import ExcelJS from "exceljs";
import { adminEmail } from "@/lib/admin-auth";
import { adminDb } from "@/lib/supabase";
import { logItem } from "@/lib/stock";

// Importa la hoja INVENTORY CONTROL (.xlsx) al inventario del CRM.
// - Busca la fila de encabezados (la que contiene «Brand») y reconoce las columnas por su nombre
// - Ignora filas de ejemplo («SAMPLE»), totales (sin marca) y la fórmula =TODAY() de «Sale Date»
// - Con fecha de venta y precio → vendido; si no, en stock (el «Sale» se toma como precio previsto)
// - No duplica: si ya existe un reloj con el mismo número de serie, se salta
export const maxDuration = 60;

const HEADERS: Record<string, string> = {
  "purchase date": "purchase_date",
  "sale date": "sale_date",
  brand: "brand",
  model: "model",
  "contact name": "supplier_name",
  "company name": "supplier_company",
  location: "supplier_location",
  client: "buyer_name",
  description: "description",
  "serial #": "serial",
  "ref #": "reference",
  dated: "papers_date",
  "links #": "links",
  condition: "condition",
  "comes with": "comes_with",
  cost: "cost",
  sale: "sale",
  "extra costs": "extra_costs",
  "asking price": "asking_price",
  "internal notes": "notes",
  acquisition: "acquisition",
};
const ACQ: Record<string, string> = { compra: "purchase", purchase: "purchase", intercambio: "trade", trade: "trade", "trade-in": "trade", consignación: "consignment", consignment: "consignment", memo: "memo", "memo de dealer": "memo" };

type Cell = ExcelJS.CellValue;
const plain = (v: Cell): unknown => {
  if (v && typeof v === "object" && !(v instanceof Date)) {
    if ("formula" in v || "sharedFormula" in v) {
      const f = String((v as { formula?: string }).formula ?? "");
      if (/TODAY\(\)/i.test(f)) return null; // fecha «de hoy» de la plantilla: no es una venta real
      return plain((v as { result?: Cell }).result ?? null);
    }
    if ("richText" in v) return (v as { richText: { text: string }[] }).richText.map((t) => t.text).join("");
    if ("text" in v) return (v as { text: string }).text;
  }
  return v;
};
const asText = (v: unknown) => {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
};
const asDate = (v: unknown) => {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = asText(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};
const asMoney = (v: unknown) => {
  if (typeof v === "number") return v;
  const s = asText(v);
  if (!s) return null;
  const n = Number(s.replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
};

export async function POST(request: Request) {
  const user = await adminEmail("costos");
  if (!user) return Response.json({ ok: false, error: "Sesión no válida" }, { status: 401 });
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ ok: false, error: "Falta el archivo" }, { status: 400 });

  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(Buffer.from(await file.arrayBuffer()) as unknown as ArrayBuffer);
  } catch {
    return Response.json({ ok: false, error: "No se pudo leer el archivo. Debe ser un Excel (.xlsx)." }, { status: 400 });
  }

  const db = adminDb();
  const { data: existing } = await db.from("inventory_items").select("serial");
  const serials = new Set((existing ?? []).map((r) => String(r.serial ?? "").trim().toLowerCase()).filter(Boolean));
  let created = 0;
  let skipped = 0;
  const notes: string[] = [];

  for (const ws of wb.worksheets) {
    // Fila de encabezados: la primera que contiene «Brand»
    let headerRow = 0;
    const map: Record<number, string> = {};
    ws.eachRow((row, n) => {
      if (headerRow) return;
      const values = (row.values as Cell[]).map((v) => String(plain(v) ?? "").trim().toLowerCase());
      if (values.includes("brand")) {
        headerRow = n;
        values.forEach((h, col) => { if (HEADERS[h]) map[col] = HEADERS[h]; });
      }
    });
    if (!headerRow) continue;

    for (let n = headerRow + 1; n <= ws.rowCount; n++) {
      const row = ws.getRow(n);
      const r: Record<string, unknown> = {};
      for (const [col, key] of Object.entries(map)) r[key] = plain(row.getCell(Number(col)).value);
      const brand = asText(r.brand);
      const text = Object.values(r).map((v) => String(v ?? "")).join(" ");
      if (!brand || /\bSAMPLE\b/i.test(text)) continue; // totales, filas vacías o de ejemplo

      const serial = asText(r.serial);
      if (serial && serials.has(serial.toLowerCase())) {
        skipped++;
        continue;
      }
      const saleDate = asDate(r.sale_date);
      const sale = asMoney(r.sale);
      const sold = Boolean(saleDate && sale != null);
      const item = {
        status: sold ? "sold" : "in_stock",
        acquisition: ACQ[String(asText(r.acquisition) ?? "").toLowerCase()] ?? "purchase",
        brand,
        model: asText(r.model),
        reference: asText(r.reference),
        serial,
        papers_date: asDate(r.papers_date),
        links: asText(r.links),
        condition: asText(r.condition),
        comes_with: asText(r.comes_with),
        description: asText(r.description),
        supplier_name: asText(r.supplier_name),
        supplier_company: asText(r.supplier_company),
        supplier_location: asText(r.supplier_location),
        purchase_date: asDate(r.purchase_date),
        cost: asMoney(r.cost),
        extra_costs: asMoney(r.extra_costs) ?? 0,
        asking_price: asMoney(r.asking_price) ?? (sold ? null : sale),
        sale_date: sold ? saleDate : null,
        sale_price: sold ? sale : null,
        buyer_name: sold ? asText(r.buyer_name) : null,
        notes: asText(r.notes),
      };
      const { data, error } = await db.from("inventory_items").insert(item).select("id").single();
      if (error) {
        notes.push(`Fila ${n}: ${error.message}`);
        continue;
      }
      if (serial) serials.add(serial.toLowerCase());
      await logItem(data.id, "import", `Importado desde «${file.name}» (fila ${n})`, user);
      created++;
    }
  }

  return Response.json({ ok: true, created, skipped, notes: notes.slice(0, 10) });
}
