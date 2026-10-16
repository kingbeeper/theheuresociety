import "server-only";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { loadAssets } from "./doc-pdf";
import { monthlyReport } from "./report";
import { adminDb } from "./supabase";

// Informe del mes para el dueño, en PDF: ventas y ganancia real, gastos, cobros pendientes, mejores
// clientes, relojes vendidos, inventario, leads y redes. Llega solo por Telegram el día 1 (del mes
// anterior) y se descarga desde Informes.

const INK = rgb(0.106, 0.122, 0.11);
const GRAY = rgb(0.365, 0.384, 0.369);
const BRASS = rgb(0.541, 0.478, 0.322);
const RULE = rgb(0.847, 0.824, 0.769);
const W = 612;
const H = 792;
const M = 54;

const T = {
  es: {
    title: "Informe del mes", sales: "Ventas", profit: "Ganancia de ventas", expenses: "Gastos del negocio", real: "Ganancia real", watches: "relojes vendidos", watch1: "reloj vendido",
    money: "Dinero", tax: "Impuesto de ventas cobrado", bought: "Compras de stock", owners: "Pagado a dueños", held: "Anticipos retenidos (pasivo)",
    receivables: "Por cobrar hoy", overdue: "vencido", top: "Mejores clientes del mes", sold: "Relojes vendidos", stock: "Inventario hoy", inStock: "Relojes disponibles",
    stockValue: "Valor a la venta", market: "Valor de mercado", leads: "Leads nuevos", appts: "Citas", social: "Redes (últimos 7 días)", reach: "Alcance", followers: "Seguidores",
    none: "Sin ventas este mes.", page: "Página", generated: "Generado el",
  },
  en: {
    title: "Monthly report", sales: "Sales", profit: "Sales profit", expenses: "Business expenses", real: "Real profit", watches: "watches sold", watch1: "watch sold",
    money: "Money", tax: "Sales tax collected", bought: "Stock purchases", owners: "Paid to owners", held: "Deposits held (liability)",
    receivables: "Receivables today", overdue: "overdue", top: "Top clients this month", sold: "Watches sold", stock: "Inventory today", inStock: "Watches available",
    stockValue: "Retail value", market: "Market value", leads: "New leads", appts: "Appointments", social: "Social media (last 7 days)", reach: "Reach", followers: "Followers",
    none: "No sales this month.", page: "Page", generated: "Generated on",
  },
};

const usd = (n: number) => `${n < 0 ? "−" : ""}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;

export async function monthlyPdf(month: string, lang: "es" | "en" = "es") {
  const t = T[lang];
  const db = adminDb();
  const [y, m] = month.split("-").map(Number);
  const start = `${month}-01T00:00:00Z`;
  const end = new Date(Date.UTC(y, m, 1)).toISOString();
  const [r, stock, leads, appts] = await Promise.all([
    monthlyReport(month),
    db.from("inventory_items").select("asking_price, market_typical").in("status", ["in_stock", "reserved"]),
    db.from("customers").select("id", { count: "exact", head: true }).gte("created_at", start).lt("created_at", end),
    db.from("appointments").select("id", { count: "exact", head: true }).gte("starts_at", start).lt("starts_at", end).neq("status", "cancelled"),
  ]);
  const { receivables } = await import("./collections");
  const rec = await receivables().catch(() => []);
  const recTotal = rec.reduce((a, d) => a + d.balance, 0);
  const recLate = rec.filter((d) => d.overdueDays).reduce((a, d) => a + d.balance, 0);
  const pulse = await import("./social-health").then((s) => s.socialPulse()).catch(() => null);
  const tt = r.totals;
  const byClient = new Map<string, number>();
  for (const s of r.sales) if (s.buyer) byClient.set(s.buyer, (byClient.get(s.buyer) ?? 0) + s.price);
  const top = [...byClient.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const items = stock.data ?? [];
  const stockValue = items.reduce((a, i) => a + Number(i.asking_price ?? 0), 0);
  const marketValue = items.reduce((a, i) => a + Number(i.market_typical ?? 0), 0);
  const label = new Intl.DateTimeFormat(lang === "en" ? "en-US" : "es-ES", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-15T12:00:00Z`));

  const a = await loadAssets();
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const display = await pdf.embedFont(a.display, { features: { liga: false, dlig: false } });
  const sans = await pdf.embedFont(a.sans, { subset: true });
  const light = await pdf.embedFont(a.light, { subset: true });
  const logo = await pdf.embedPng(a.logo);
  pdf.setTitle(`${t.title} · ${label} · The Heure Society`);

  let page: PDFPage = pdf.addPage([W, H]);
  let yy = H - M;
  const text = (s: string, x: number, y: number, o: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; right?: boolean } = {}) => {
    const font = o.font ?? sans;
    const size = o.size ?? 9;
    const str = s.normalize("NFC");
    page.drawText(str, { x: o.right ? x - font.widthOfTextAtSize(str, size) : x, y, size, font, color: o.color ?? INK });
  };
  const need = (h: number) => {
    if (yy - h < M) {
      page = pdf.addPage([W, H]);
      yy = H - M;
    }
  };
  const section = (title: string) => {
    need(40);
    yy -= 22;
    text(title.toUpperCase(), M, yy, { size: 7.5, color: BRASS });
    yy -= 6;
    page.drawLine({ start: { x: M, y: yy }, end: { x: W - M, y: yy }, thickness: 0.5, color: RULE });
    yy -= 14;
  };
  const row = (k: string, v: string, o: { bold?: boolean; color?: ReturnType<typeof rgb> } = {}) => {
    need(16);
    text(k, M, yy, { font: o.bold ? sans : light, size: 9.5, color: GRAY });
    text(v, W - M, yy, { font: o.bold ? sans : light, size: 9.5, color: o.color ?? INK, right: true });
    yy -= 15;
  };

  // Cabecera
  const lw = 34;
  page.drawImage(logo, { x: M, y: yy - lw + 8, width: lw, height: lw * (logo.height / logo.width) });
  text("THE HEURE SOCIETY", M + lw + 12, yy - 4, { size: 8, color: BRASS });
  text(`${t.title} · ${label.charAt(0).toUpperCase()}${label.slice(1)}`, M + lw + 12, yy - 26, { font: display, size: 22 });
  yy -= 52;

  // Cifras grandes
  const kpis: [string, string][] = [[t.sales, usd(tt.revenue)], [t.real, usd(tt.profit - tt.businessExpenses)], [t.receivables, usd(recTotal)]];
  const colW = (W - 2 * M) / kpis.length;
  kpis.forEach(([k, v], i) => {
    text(v, M + i * colW, yy - 18, { font: display, size: 24 });
    text(k.toUpperCase(), M + i * colW, yy - 32, { size: 7, color: GRAY });
  });
  yy -= 46;

  section(t.sales);
  row(t.sales, `${usd(tt.revenue)} · ${r.sales.length} ${r.sales.length === 1 ? t.watch1 : t.watches}`, { bold: true });
  row(t.profit, usd(tt.profit));
  row(t.expenses, `− ${usd(tt.businessExpenses)}`);
  row(t.real, usd(tt.profit - tt.businessExpenses), { bold: true, color: tt.profit - tt.businessExpenses < 0 ? rgb(0.6, 0.15, 0.15) : INK });

  section(t.money);
  row(t.tax, usd(tt.taxCollected));
  row(t.bought, usd(tt.bought));
  row(t.owners, usd(tt.ownerPaid));
  row(t.held, usd(tt.depositsHeld));
  row(t.receivables, `${usd(recTotal)}${recLate ? ` · ${usd(recLate)} ${t.overdue}` : ""}`, { bold: true });

  section(t.top);
  if (top.length) top.forEach(([name, total], i) => row(`${i + 1}. ${name}`, usd(total)));
  else row(t.none, "");

  section(t.sold);
  if (r.sales.length) for (const s of r.sales.slice(0, 15)) row(`${s.date.slice(5).replace("-", "/")} · ${s.watch}`.slice(0, 70), usd(s.price));
  else row(t.none, "");

  section(t.stock);
  row(t.inStock, String(items.length));
  row(t.stockValue, usd(stockValue));
  if (marketValue) row(t.market, usd(marketValue));
  row(t.leads, String(leads.count ?? 0));
  row(t.appts, String(appts.count ?? 0));

  if (pulse) {
    section(t.social);
    row(t.reach, Math.round(pulse.week.reach).toLocaleString("en-US"));
    if (pulse.followers.now != null) row(t.followers, `${pulse.followers.now.toLocaleString("en-US")}${pulse.followers.delta7 != null ? ` (${pulse.followers.delta7 >= 0 ? "+" : ""}${pulse.followers.delta7})` : ""}`);
  }

  // Pie
  const pages = pdf.getPages();
  const today = new Intl.DateTimeFormat(lang === "en" ? "en-US" : "es-ES", { dateStyle: "medium", timeZone: "America/New_York" }).format(new Date());
  pages.forEach((p, i) => {
    page = p;
    text(`${t.generated} ${today} · ${t.page} ${i + 1}/${pages.length}`, W - M, 30, { size: 7, color: GRAY, right: true });
  });
  return { bytes: await pdf.save(), filename: `${lang === "en" ? "Report" : "Informe"} ${month} - The Heure Society.pdf` };
}

// Día 1: informe del mes anterior a todo el equipo por Telegram
export async function sendMonthlyPdf() {
  const now = new Date();
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15)).toISOString().slice(0, 7);
  const { bytes, filename } = await monthlyPdf(prev, "es");
  const { notifyAdminsDocument } = await import("./telegram");
  await notifyAdminsDocument(bytes, filename, `📊 Informe de ${prev}: ventas, ganancia real, cobros, mejores clientes e inventario.`);
}
