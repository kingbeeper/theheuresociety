import "server-only";
import ExcelJS from "exceljs";
import { adminDb } from "./supabase";

// Copia de seguridad: un Excel con todas las tablas del negocio (una hoja por tabla), guardado en un
// almacenamiento PRIVADO de Supabase («backups»). Se hace sola los domingos con el resumen de la mañana
// y se puede hacer a mano desde Informes. Se guardan las 12 últimas.

const BUCKET = "backups";
const KEEP = 12;
// Lo que importa del negocio (las conversaciones y métricas de redes se pueden volver a traer)
const TABLES = [
  "customers", "customer_events", "watch_alerts", "reminders", "appointments", "appointment_followups",
  "inventory_items", "inventory_events", "item_services", "serial_log", "watches",
  "documents", "payments", "shipments", "customer_tasks", "inventory_counts", "sell_requests", "dealer_requests", "business_expenses", "staff_tasks", "crm_users",
];

async function allRows(table: string) {
  const db = adminDb();
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select("*").range(from, from + 999);
    if (error) return { rows, error: error.message };
    rows.push(...((data ?? []) as Record<string, unknown>[]));
    if (!data || data.length < 1000) return { rows, error: null };
  }
}

const cell = (v: unknown) => (v == null ? null : typeof v === "object" ? JSON.stringify(v) : v);

export async function buildBackup() {
  const wb = new ExcelJS.Workbook();
  wb.creator = "The Heure Society CRM";
  const counts: Record<string, number> = {};
  for (const t of TABLES) {
    const { rows, error } = await allRows(t);
    if (error && !rows.length) continue; // tabla que aún no existe en esta base
    const ws = wb.addWorksheet(t.slice(0, 31));
    const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    ws.columns = keys.map((k) => ({ header: k, key: k, width: Math.min(40, Math.max(10, k.length + 2)) }));
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: "frozen", ySplit: 1 }];
    for (const r of rows) ws.addRow(Object.fromEntries(keys.map((k) => [k, cell(r[k])])));
    counts[t] = rows.length;
  }
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), counts };
}

async function bucket() {
  const storage = adminDb().storage;
  const { data } = await storage.getBucket(BUCKET);
  if (!data) await storage.createBucket(BUCKET, { public: false });
  return storage.from(BUCKET);
}

export async function listBackups() {
  const b = await bucket();
  const { data } = await b.list("", { sortBy: { column: "name", order: "desc" }, limit: 100 });
  return (data ?? []).filter((f) => f.name.endsWith(".xlsx")).map((f) => ({ name: f.name, size: Number(f.metadata?.size ?? 0), created: f.created_at ?? null }));
}

// Enlace temporal de descarga (privado: caduca)
export async function backupLink(name: string, seconds = 7 * 86_400) {
  const b = await bucket();
  const { data } = await b.createSignedUrl(name, seconds, { download: name });
  return data?.signedUrl ?? null;
}

export async function makeBackup() {
  const { buffer, counts } = await buildBackup();
  const stamp = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  const name = `copia-${stamp}-${Date.now().toString(36)}.xlsx`;
  const b = await bucket();
  const { error } = await b.upload(name, buffer, { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", upsert: true });
  if (error) throw new Error(`No se pudo guardar la copia: ${error.message}`);
  // Solo se guardan las últimas
  const all = await listBackups();
  const old = all.slice(KEEP).map((f) => f.name);
  if (old.length) await b.remove(old);
  return { name, size: buffer.length, counts };
}

// Copia semanal (domingos) con aviso por Telegram y enlace de descarga de 7 días
export async function weeklyBackup() {
  const { notifyAdmins } = await import("./telegram");
  try {
    const r = await makeBackup();
    const link = await backupLink(r.name);
    const total = Object.values(r.counts).reduce((a, n) => a + n, 0);
    await notifyAdmins(
      `🗄 <b>Copia de seguridad semanal</b>\n${total.toLocaleString("en-US")} registros (${r.counts.customers ?? 0} clientes, ${r.counts.inventory_items ?? 0} relojes, ${r.counts.documents ?? 0} documentos) · ${(r.size / 1024).toFixed(0)} KB\n${link ? `Descargar (enlace válido 7 días): ${link}` : ""}\nTambién en CRM → Informes → Copias de seguridad.`
    );
  } catch (e) {
    await notifyAdmins(`⚠️ La copia de seguridad semanal falló: ${(e as Error).message.slice(0, 200)}`);
  }
}
