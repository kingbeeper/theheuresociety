import "server-only";
import { randomBytes } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { adminDb } from "./supabase";
import { addEvent, upsertLead } from "./crm";
import { docTotals, type DocLine } from "./doc-labels";

// Importar facturas de antes del CRM: de un PDF o una foto (la IA lee los datos) o de un Excel con la
// plantilla. Cada factura crea (o completa) la ficha del cliente, la factura pagada con su número original
// y la venta en el inventario (la pieza vendida con su serial), para que cuente en Clientes, informes y
// el historial de seriales.

const client = new Anthropic();
const MODEL = "claude-sonnet-5-5";

const LineSchema = z.object({
  title: z.string().describe("Pieza: marca, modelo y referencia (o tipo de joya y nombre)"),
  details: z.string().nullable().describe("Detalles: año, estado, caja y papeles, metal, piedra, quilates, talla…"),
  serial: z.string().nullable().describe("Número de serie si aparece, exacto"),
  category: z.enum(["watch", "jewelry", "other"]).describe("watch = reloj, jewelry = joya, other = servicio u otra cosa"),
  qty: z.number().describe("Cantidad (normalmente 1)"),
  price: z.number().describe("Precio unitario en USD, sin impuesto"),
});
const InvoiceSchema = z.object({
  number: z.string().nullable().describe("Número de la factura tal cual aparece"),
  date: z.string().nullable().describe("Fecha de la factura, AAAA-MM-DD"),
  client_name: z.string().nullable(),
  client_phone: z.string().nullable(),
  client_email: z.string().nullable(),
  client_address: z.string().nullable(),
  lang: z.enum(["en", "es"]).describe("Idioma de la factura"),
  items: z.array(LineSchema),
  discount: z.number().describe("Descuento total en USD (0 si no hay)"),
  tax_rate: z.number().describe("Impuesto de ventas en % (0 si no hay)"),
  shipping: z.number().describe("Envío en USD (0 si no hay)"),
  total: z.number().nullable().describe("Total de la factura en USD"),
  payment_method: z.string().nullable().describe("Forma de pago si aparece (Wire, Zelle, Cash…)"),
  notes: z.string().nullable().describe("Observaciones relevantes, o null"),
});
export type ImportedInvoice = z.infer<typeof InvoiceSchema>;

// Lee una factura de un PDF o una foto
export async function readInvoiceFile(base64: string, mediaType: string): Promise<ImportedInvoice | null> {
  const isPdf = mediaType === "application/pdf";
  const block = isPdf
    ? { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data: base64 } }
    : { type: "image" as const, source: { type: "base64" as const, media_type: (["image/png", "image/webp", "image/gif"].includes(mediaType) ? mediaType : "image/jpeg") as "image/jpeg", data: base64 } };
  const res = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { format: betaZodOutputFormat(InvoiceSchema) },
    messages: [
      {
        role: "user",
        content: [
          block,
          { type: "text", text: "Es una factura de venta de un dealer de relojes y joyas de Miami. Extrae sus datos exactamente como aparecen. Precios en USD sin el símbolo. Si un dato no aparece, null (o 0 en importes). No inventes nada." },
        ],
      },
    ],
  });
  return res.parsed_output ?? null;
}

const PAYMENT_ES: Record<string, string> = { wire: "Transferencia", "wire transfer": "Transferencia", transfer: "Transferencia", transferencia: "Transferencia", zelle: "Zelle", cash: "Efectivo", efectivo: "Efectivo", card: "Tarjeta", "credit card": "Tarjeta", tarjeta: "Tarjeta", crypto: "Cripto", check: "Cheque", cheque: "Cheque" };
const paymentEs = (m: string | null | undefined) => (m ? PAYMENT_ES[m.trim().toLowerCase()] ?? m.trim() : null);

// Guarda una factura importada: cliente, factura pagada (número original) y piezas vendidas
export async function saveImportedInvoice(inv: ImportedInvoice, user: string, file: string | null) {
  const db = adminDb();
  const day = inv.date && /^\d{4}-\d{2}-\d{2}$/.test(inv.date) ? inv.date : new Date().toISOString().slice(0, 10);
  const number = (inv.number?.trim() || `IMP-${day}-${randomBytes(2).toString("hex")}`).slice(0, 40);
  const { data: dup } = await db.from("documents").select("id").eq("number", number).maybeSingle();
  if (dup) return { error: `Ya existe un documento con el número ${number}.` };
  if (!inv.items.length) return { error: "La factura no tiene piezas." };
  if (!inv.client_name?.trim()) return { error: "Falta el nombre del cliente." };

  // Cliente (si ya existe por teléfono o correo, se completa)
  const customer = await upsertLead({ name: inv.client_name.trim(), phone: inv.client_phone, email: inv.client_email, source: "other", intent: "buy", stage: "won", notify: false });
  const method = paymentEs(inv.payment_method);

  // Piezas vendidas en el inventario (una por línea; con cantidad, el importe de la línea)
  const lines: DocLine[] = [];
  const created: string[] = [];
  for (const l of inv.items) {
    const words = l.title.trim().split(/\s+/);
    const { data: it, error } = await db
      .from("inventory_items")
      .insert({
        category: l.category,
        acquisition: "purchase",
        status: "sold",
        brand: words.shift() ?? "?",
        model: words.join(" ") || null,
        serial: l.serial?.trim() || null,
        description: l.details,
        sale_date: day,
        sale_price: Math.round(l.price * (l.qty || 1) * 100) / 100,
        buyer_customer_id: customer.id,
        buyer_name: inv.client_name,
        payment_method: method,
        notes: `Importado de la factura ${number}${file ? ` (${file})` : ""}`,
      })
      .select("id, sku")
      .single();
    if (error) {
      for (const id of created) await db.from("inventory_items").delete().eq("id", id);
      return { error: `No se pudo crear la pieza «${l.title}»: ${error.message}` };
    }
    created.push(it.id as string);
    lines.push({ item_id: it.id as string, sku: it.sku as string, title: l.title, details: l.details, serial: l.serial, qty: l.qty || 1, price: l.price });
  }

  const totals = docTotals({ items: lines, discount: inv.discount || 0, tax_rate: inv.tax_rate || 0, shipping: inv.shipping || 0 });
  const { data: doc, error } = await db
    .from("documents")
    .insert({
      kind: "invoice",
      number,
      token: randomBytes(18).toString("base64url"),
      status: "paid",
      customer_id: customer.id,
      client_name: inv.client_name,
      client_phone: inv.client_phone,
      client_email: inv.client_email,
      client_address: inv.client_address,
      lang: inv.lang,
      issue_date: day,
      due_date: day,
      paid_at: day,
      items: lines,
      discount: inv.discount || 0,
      tax_rate: inv.tax_rate || 0,
      shipping: inv.shipping || 0,
      subtotal: totals.subtotal,
      total: totals.total,
      show_serial: true,
      payment_method: method,
      notes: inv.notes,
      imported_from: file ?? "manual",
      created_by: user,
    })
    .select("id, number")
    .single();
  if (error) {
    for (const id of created) await db.from("inventory_items").delete().eq("id", id);
    return { error: error.message };
  }
  await addEvent(customer.id, "document", `Factura importada ${number} (${day}) · $${totals.total.toLocaleString("en-US")}`, { document: doc.id }, user);
  return { ok: true as const, id: doc.id as string, number, customerId: customer.id, total: totals.total, mismatch: inv.total != null && Math.abs(inv.total - totals.total) > 1 ? inv.total : null };
}

// Excel con la plantilla: una fila por pieza; las filas con el mismo número de factura van juntas
export async function readInvoiceSheet(buffer: ArrayBuffer): Promise<ImportedInvoice[]> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const head = (ws.getRow(1).values as unknown[]).map((v) => String(v ?? "").trim().toLowerCase());
  const col = (...names: string[]) => head.findIndex((h) => names.includes(h));
  const c = {
    number: col("factura", "invoice", "número", "numero"), date: col("fecha", "date"), name: col("cliente", "client"), phone: col("teléfono", "telefono", "phone"),
    email: col("correo", "email"), address: col("dirección", "direccion", "address"), title: col("pieza", "item", "descripción"), details: col("detalles", "details"),
    serial: col("serial", "serie"), kind: col("tipo", "type"), qty: col("cantidad", "qty"), price: col("precio", "price"), tax: col("impuesto %", "tax %", "impuesto"),
    method: col("forma de pago", "payment", "pago"), lang: col("idioma", "language"),
  };
  const val = (row: unknown[], i: number) => {
    if (i < 0) return null;
    const v = row[i] as unknown;
    if (v == null || v === "") return null;
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v === "object" && v && "text" in (v as Record<string, unknown>)) return String((v as { text: string }).text);
    if (typeof v === "object" && v && "result" in (v as Record<string, unknown>)) return String((v as { result: unknown }).result);
    return String(v).trim();
  };
  const num = (s: string | null) => (s ? Number(s.replace(/[^\d.-]/g, "")) || 0 : 0);
  const groups = new Map<string, ImportedInvoice>();
  ws.eachRow((r, i) => {
    if (i === 1) return;
    const row = r.values as unknown[];
    const title = val(row, c.title);
    if (!title) return;
    const key = val(row, c.number) ?? `fila-${i}`;
    const kind = (val(row, c.kind) ?? "").toLowerCase();
    const inv = groups.get(key) ?? {
      number: val(row, c.number), date: val(row, c.date), client_name: val(row, c.name), client_phone: val(row, c.phone), client_email: val(row, c.email), client_address: val(row, c.address),
      lang: (val(row, c.lang) ?? "en").toLowerCase().startsWith("es") ? ("es" as const) : ("en" as const),
      items: [], discount: 0, tax_rate: num(val(row, c.tax)), shipping: 0, total: null, payment_method: val(row, c.method), notes: null,
    };
    inv.items.push({ title, details: val(row, c.details), serial: val(row, c.serial), category: /joya|jewel/.test(kind) ? "jewelry" : /otro|other|servic/.test(kind) ? "other" : "watch", qty: num(val(row, c.qty)) || 1, price: num(val(row, c.price)) });
    groups.set(key, inv);
  });
  return [...groups.values()];
}
