import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PDFDocument, degrees, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { PRINT, balanceDue, docTotals, maskedId, usd, type Doc, type DocSettings } from "./doc-labels";
import { downloadPrivate } from "./private-files";

// PDF de cotizaciones, memos, facturas y consignaciones, con el mismo diseño que la página del
// cliente (/d/…). Se genera en el servidor: sirve para descargarlo y para enviarlo por Telegram.

const ASSETS = join(process.cwd(), "src/lib/pdf-assets");
let assets: Promise<Record<"display" | "sans" | "light" | "logo", Uint8Array>> | null = null;
export const loadAssets = () =>
  (assets ??= Promise.all(["cormorant.ttf", "montserrat.ttf", "montserrat-light.ttf", "monogram.png"].map((f) => readFile(join(ASSETS, f)))).then(
    ([display, sans, light, logo]) => ({ display, sans, light, logo })
  ));

const INK = rgb(0.106, 0.122, 0.11);
const GRAY = rgb(0.365, 0.384, 0.369);
const BRASS = rgb(0.541, 0.478, 0.322);
const RULE = rgb(0.847, 0.824, 0.769);
const SOFT = rgb(0.925, 0.906, 0.863);

const W = 612; // carta (8,5 × 11 in)
const H = 792;
const M = 54;

export async function renderDocPdf(d: Doc, s: Required<DocSettings>) {
  const a = await loadAssets();
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  // Cormorant pierde letras si se recorta (fallo conocido de fontkit): se incrusta completa
  const display = await pdf.embedFont(a.display, { features: { liga: false, dlig: false } }); // sin ligaduras: «fi» saldría con hueco
  const sans = await pdf.embedFont(a.sans, { subset: true });
  const light = await pdf.embedFont(a.light, { subset: true });
  const logo = await pdf.embedPng(a.logo);
  const t = PRINT[d.lang];
  const consign = d.kind === "consignment";
  const purchase = d.kind === "purchase";
  const sourcing = d.kind === "sourcing";
  const deposit = Number(d.deposit ?? 0);
  const sellerId = purchase ? maskedId(d) : null;
  const totals = docTotals(d);
  pdf.setTitle(`${t[d.kind]} ${d.number} · ${s.doc_company}`);
  pdf.setAuthor(s.doc_company);

  let page: PDFPage = pdf.addPage([W, H]);
  let y = H - M;

  // ── utilidades de dibujo ──
  type Opt = { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; align?: "left" | "right" | "center"; track?: number };
  const width = (str: string, font: PDFFont, size: number, track = 0) => font.widthOfTextAtSize(str, size) + track * Math.max(0, str.length - 1);
  const text = (raw: string, x: number, yy: number, o: Opt = {}) => {
    const str = raw.normalize("NFC");
    const font = o.font ?? sans;
    const size = o.size ?? 9;
    const track = o.track ?? 0;
    const w = width(str, font, size, track);
    let cx = o.align === "right" ? x - w : o.align === "center" ? x - w / 2 : x;
    if (!track) return page.drawText(str, { x: cx, y: yy, font, size, color: o.color ?? INK });
    // Espaciado entre letras (etiquetas en versalitas), letra a letra
    for (const ch of str) {
      page.drawText(ch, { x: cx, y: yy, font, size, color: o.color ?? INK });
      cx += font.widthOfTextAtSize(ch, size) + track;
    }
  };
  const label = (str: string, x: number, yy: number, o: Opt = {}) => text(str.toUpperCase(), x, yy, { font: sans, size: 6.5, color: GRAY, track: 1.4, ...o });
  const rule = (yy: number, x1 = M, x2 = W - M, color = RULE, thickness = 0.7) => page.drawLine({ start: { x: x1, y: yy }, end: { x: x2, y: yy }, thickness, color });
  const wrap = (str: string, font: PDFFont, size: number, max: number) =>
    str.split("\n").flatMap((para) => {
      const out: string[] = [];
      let line = "";
      for (const word of para.split(/\s+/)) {
        const next = line ? `${line} ${word}` : word;
        if (line && font.widthOfTextAtSize(next, size) > max) {
          out.push(line);
          line = word;
        } else line = next;
      }
      return [...out, line];
    });
  // Salto de página si no cabe el bloque siguiente
  const ensure = (space: number) => {
    if (y - space >= M) return;
    page = pdf.addPage([W, H]);
    y = H - M;
  };

  // ── cabecera ──
  const logoH = 40;
  const logoW = (logo.width / logo.height) * logoH;
  page.drawImage(logo, { x: M, y: y - logoH, width: logoW, height: logoH });
  const cx = M + logoW + 12;
  text(s.doc_company.toUpperCase(), cx, y - 13, { font: display, size: 15, track: 2.6 });
  const contact = [...s.doc_address.split("\n"), [s.doc_phone, s.doc_email].filter(Boolean).join(" · "), s.doc_tax_id ? `EIN ${s.doc_tax_id}` : ""].filter(Boolean);
  contact.forEach((l, i) => text(l, cx, y - 28 - i * 11, { font: light, size: 8, color: GRAY }));

  const title = t[d.kind];
  text(title, W - M, y - 20, { font: display, size: consign || sourcing ? 21 : 26, align: "right", track: 0.6 });
  const date = (iso: string | null) =>
    iso ? new Intl.DateTimeFormat(d.lang === "es" ? "es-ES" : "en-US", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`)) : "-";
  const meta: [string, string][] = [[t.number, d.number], [t.date, date(d.issue_date)], ...(d.due_date && t.due[d.kind] ? [[t.due[d.kind], date(d.due_date)] as [string, string]] : [])];
  meta.forEach(([k, v], i) => {
    text(v, W - M, y - 40 - i * 12, { size: 8.5, align: "right" });
    text(k, W - M - 110, y - 40 - i * 12, { font: light, size: 8.5, color: GRAY, align: "right" });
  });
  y -= Math.max(28 + contact.length * 11, 40 + meta.length * 12) + 16;
  rule(y);

  // Sello de pagada / anulada
  const stamp = d.status === "void" ? t.void : d.status === "paid" && !consign ? t.paid : null;
  if (stamp) {
    const green = rgb(0.18, 0.42, 0.3);
    page.drawText(stamp, { x: W - M - 150, y: y - 60, font: display, size: 30, color: green, opacity: 0.55, rotate: degrees(12) });
  }

  // ── cliente ──
  y -= 24;
  label(t.billTo[d.kind], M, y, { color: BRASS });
  y -= 18;
  text(d.client_name ?? "", M, y, { font: display, size: 14 });
  const who = [d.client_company, ...(d.client_address ?? "").split("\n"), [d.client_phone, d.client_email].filter(Boolean).join(" · "), sellerId && `${t.sellerId}: ${sellerId}`].filter(Boolean) as string[];
  for (const l of who) {
    y -= 12;
    text(l, M, y, { font: light, size: 9, color: GRAY });
  }

  // ── líneas ──
  const colQty = 372;
  const colPrice = consign ? 440 : 462;
  const right = W - M;
  const descW = colQty - M - 30;
  y -= 26;
  rule(y + 12);
  label(sourcing ? t.sought : t.item, M, y);
  label(t.qty, colQty, y, { align: "center" });
  label(t.price, colPrice, y, { align: "right" });
  label(consign ? t.net : t.amount, right, y, { align: "right" });
  y -= 8;
  rule(y);

  for (const l of d.items) {
    const titleLines = wrap(l.title, display, 12, descW);
    const detailLines = [...(l.details ? wrap(l.details, light, 8, descW) : []), ...(d.show_serial && l.serial ? [`${t.serial}: ${l.serial}`] : [])];
    ensure(24 + titleLines.length * 14 + detailLines.length * 11);
    y -= 18;
    const top = y;
    titleLines.forEach((tl, i) => text(tl, M, top - i * 14, { font: display, size: 12 }));
    y = top - (titleLines.length - 1) * 14;
    for (const dl of detailLines) {
      y -= 11;
      text(dl, M, y, { font: light, size: 8, color: GRAY });
    }
    text(String(l.qty), colQty, top, { size: 9, align: "center" });
    text(usd(l.price), colPrice, top, { size: 9, align: "right" });
    text(usd(l.qty * l.price), right, top, { size: 9, align: "right" });
    y -= 12;
    rule(y, M, right, SOFT);
  }

  // ── totales ──
  const rows: [string, string][] = [[t.subtotal, usd(totals.subtotal)]];
  if (totals.discount > 0) rows.push([t.discount, `-${usd(totals.discount)}`]);
  if (totals.tax > 0) rows.push([`${t.tax} (${Number(d.tax_rate)}%)`, usd(totals.tax)]);
  if (totals.shipping > 0) rows.push([t.shipping, usd(totals.shipping)]);
  ensure(30 + rows.length * 16 + 30);
  y -= 22;
  const tx = right - 210;
  for (const [k, v] of rows) {
    text(k, tx, y, { font: light, size: 9, color: GRAY });
    text(v, right, y, { size: 9, align: "right" });
    y -= 16;
  }
  rule(y + 6, tx, right, INK, 0.9);
  y -= 12;
  text(consign ? t.netTotal : purchase ? t.paidTotal : sourcing ? t.upTo : t.total, tx, y, { font: display, size: 14 });
  text(usd(totals.total), right, y, { font: display, size: 14, align: "right" });
  // Anticipo del encargo, o el anticipo descontado en la factura y el saldo
  const after: [string, string, boolean][] = [];
  if (sourcing && deposit > 0) after.push([d.refunded_at && d.deposit_paid_at ? t.depositRefunded : d.deposit_paid_at ? t.depositPaid : t.depositDue, usd(deposit), false]);
  if (d.kind === "invoice" && deposit > 0) after.push([t.lessDeposit, `-${usd(deposit)}`, false], [t.balance, usd(balanceDue(d)), true]);
  for (const [k, v, big] of after) {
    y -= big ? 20 : 16;
    text(k, tx, y, big ? { font: display, size: 13 } : { font: light, size: 9, color: GRAY });
    text(v, right, y, big ? { font: display, size: 13, align: "right" } : { size: 9, align: "right" });
  }

  // ── notas, pago, términos ──
  y -= 26;
  rule(y);
  y -= 6;
  const block = (title: string, body: string) => {
    const lines = wrap(body, light, 8.5, W - 2 * M);
    ensure(24 + lines.length * 12);
    y -= 16;
    label(title, M, y, { color: BRASS });
    for (const l of lines) {
      y -= 12;
      text(l, M, y, { font: light, size: 8.5, color: INK });
    }
  };
  if (d.notes) block(t.notes, d.notes);
  const payment = [d.payment_method, d.status === "paid" || purchase ? null : s.doc_payment_info].filter(Boolean).join("\n");
  if (d.kind !== "memo" && !consign && payment) block(t.payment, payment);
  if (d.terms) block(t.terms, d.terms);

  // ── firmas ──
  const half = (W - 2 * M - 30) / 2;
  const sigBytes = d.signature_path ? await downloadPrivate(d.signature_path) : null;
  const sigImage = sigBytes ? await pdf.embedPng(sigBytes) : null;
  const signedOn = d.signed_at
    ? new Intl.DateTimeFormat(d.lang === "es" ? "es-ES" : "en-US", { dateStyle: "long", timeStyle: "short", timeZone: "America/New_York" }).format(new Date(d.signed_at))
    : "";
  const drawSignature = (x: number, lineY: number) => {
    if (!sigImage) return;
    const h = 34;
    const w = Math.min(half - 10, (sigImage.width / sigImage.height) * h);
    page.drawImage(sigImage, { x: x + 4, y: lineY + 2, width: w, height: (w / ((sigImage.width / sigImage.height) * h)) * h });
  };
  const signedCaption = (x: number, yy: number, label: string) =>
    text(`${label} ${d.signer_name ?? ""} · ${signedOn} (Miami)`, x, yy, { font: light, size: 6.8, color: GRAY });
  const sign = (x: number, yy: number, caption: string, client = false) => {
    if (client) drawSignature(x, yy);
    rule(yy, x, x + half, INK, 0.8);
    text(caption, x, yy - 11, { font: light, size: 8, color: GRAY });
    if (client && sigImage) signedCaption(x, yy - 22, t.signedBy);
  };
  if (d.kind === "memo") {
    ensure(70);
    y -= 50;
    sign(M, y, t.signature, true);
    sign(M + half + 30, y, t.date);
    if (sigImage) text(signedOn, M + half + 34, y + 4, { size: 8.5 });
  }
  if (consign || purchase || sourcing) {
    const who = purchase ? t.purchaseSign : sourcing ? t.sourcingSign : t.consignSign;
    ensure(110);
    y -= 50;
    sign(M, y, who[0], true);
    sign(M + half + 30, y, who[1]);
    y -= sigImage ? 50 : 34; // con firma, deja sitio a la línea «firmado electrónicamente por…»
    if (sigImage) text(signedOn, M + 4, y + 4, { size: 8.5 });
    sign(M, y, t.date);
    sign(M + half + 30, y, t.date);
  }

  // Factura o cotización firmada: bloque «aceptado y firmado por»
  if (sigImage && (d.kind === "invoice" || d.kind === "quote")) {
    ensure(80);
    y -= 56;
    drawSignature(M, y);
    rule(y, M, M + half, INK, 0.8);
    signedCaption(M, y - 11, t.acceptedBy);
  }

  return pdf.save();
}

export const pdfName = (d: Pick<Doc, "number" | "client_name">) =>
  `${d.number}${d.client_name ? ` ${d.client_name.replace(/[^\p{L}\p{N} .-]/gu, "").trim()}` : ""}.pdf`;
