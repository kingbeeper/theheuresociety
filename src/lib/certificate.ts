import "server-only";
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { adminDb } from "./supabase";
import { loadAssets } from "./doc-pdf";
import type { DocSettings } from "./doc-labels";

// Certificado de autenticidad de cada reloj vendido: una página por reloj, con su foto,
// sus datos (referencia, serie, papeles…) y la firma de la casa.

const INK = rgb(0.106, 0.122, 0.11);
const GRAY = rgb(0.365, 0.384, 0.369);
const BRASS = rgb(0.541, 0.478, 0.322);
const RULE = rgb(0.847, 0.824, 0.769);
const W = 612;
const H = 792;

export type CertItem = {
  sku: string;
  brand: string;
  model: string | null;
  reference: string | null;
  serial: string | null;
  papers_date: string | null;
  condition: string | null;
  comes_with: string | null;
  photo: string | null;
  owner: string | null;
  date: string; // fecha de emisión (la de la venta)
};

const T = {
  en: {
    title: "Certificate of Authenticity", no: "Certificate No.", issued: "Issued", owner: "Issued to",
    brand: "Brand", model: "Model", reference: "Reference", serial: "Serial number", papers: "Papers dated", condition: "Condition", set: "Includes",
    statement: (b: string) =>
      `The Heure Society certifies that the timepiece described above has been examined by our specialists and is, to the best of our knowledge, an authentic ${b} timepiece. Any non-original parts, service history or other relevant details known to us are noted above.`,
    sign: "The Heure Society — authorized signature",
  },
  es: {
    title: "Certificado de autenticidad", no: "Certificado n.º", issued: "Emitido", owner: "A nombre de",
    brand: "Marca", model: "Modelo", reference: "Referencia", serial: "Número de serie", papers: "Papeles con fecha", condition: "Estado", set: "Incluye",
    statement: (b: string) =>
      `The Heure Society certifica que el reloj descrito ha sido examinado por nuestros especialistas y que, a nuestro leal saber, es un reloj ${b} auténtico. Cualquier pieza no original, historial de servicio u otro dato relevante que conozcamos figura arriba.`,
    sign: "The Heure Society — firma autorizada",
  },
};

async function photoFor(pdf: PDFDocument, url: string | null): Promise<PDFImage | null> {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    return bytes[0] === 0x89 ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
  } catch {
    return null;
  }
}

export async function renderCertificates(items: CertItem[], lang: "en" | "es", s: Required<DocSettings>) {
  const a = await loadAssets();
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const display = await pdf.embedFont(a.display, { features: { liga: false, dlig: false } }); // sin ligaduras: «fi» saldría con hueco
  const sans = await pdf.embedFont(a.sans, { subset: true });
  const light = await pdf.embedFont(a.light, { subset: true });
  const logo = await pdf.embedPng(a.logo);
  const t = T[lang];
  pdf.setTitle(`${t.title} · ${s.doc_company}`);

  for (const it of items) {
    const page: PDFPage = pdf.addPage([W, H]);
    const center = (str: string, y: number, font: PDFFont, size: number, color = INK, track = 0) => {
      const w = font.widthOfTextAtSize(str, size) + track * (str.length - 1);
      let x = (W - w) / 2;
      if (!track) return page.drawText(str, { x, y, font, size, color });
      for (const ch of str) {
        page.drawText(ch, { x, y, font, size, color });
        x += font.widthOfTextAtSize(ch, size) + track;
      }
    };
    // Marco doble
    page.drawRectangle({ x: 28, y: 28, width: W - 56, height: H - 56, borderColor: BRASS, borderWidth: 0.8 });
    page.drawRectangle({ x: 34, y: 34, width: W - 68, height: H - 68, borderColor: RULE, borderWidth: 0.5 });

    let y = H - 92;
    const lh = 44;
    page.drawImage(logo, { x: (W - (logo.width / logo.height) * lh) / 2, y: y - lh, width: (logo.width / logo.height) * lh, height: lh });
    y -= lh + 22;
    center(s.doc_company.toUpperCase(), y, display, 13, INK, 3);
    y -= 34;
    center(t.title, y, display, 28);
    y -= 20;
    const date = new Intl.DateTimeFormat(lang === "es" ? "es-ES" : "en-US", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${it.date}T12:00:00Z`));
    center(`${t.no} ${it.sku}-COA  ·  ${t.issued} ${date}`, y, light, 8.5, GRAY);

    // Foto
    y -= 22;
    const photo = await photoFor(pdf, it.photo);
    if (photo) {
      const maxW = 240;
      const maxH = 200;
      const k = Math.min(maxW / photo.width, maxH / photo.height);
      const pw = photo.width * k;
      const ph = photo.height * k;
      page.drawImage(photo, { x: (W - pw) / 2, y: y - ph, width: pw, height: ph });
      y -= ph + 26;
    } else y -= 10;

    // Datos del reloj
    const rows: [string, string | null][] = [
      [t.brand, it.brand], [t.model, it.model], [t.reference, it.reference], [t.serial, it.serial],
      [t.papers, it.papers_date ? it.papers_date.slice(0, 7) : null], [t.condition, it.condition], [t.set, it.comes_with],
    ];
    const lx = 150;
    const vx = 290;
    page.drawLine({ start: { x: lx, y: y + 10 }, end: { x: W - lx, y: y + 10 }, thickness: 0.6, color: RULE });
    for (const [k, v] of rows.filter(([, v]) => v)) {
      page.drawText(k.toUpperCase(), { x: lx, y, font: sans, size: 6.8, color: GRAY });
      page.drawText(String(v), { x: vx, y: y - 1, font: display, size: 12.5, color: INK });
      y -= 21;
    }
    page.drawLine({ start: { x: lx, y: y + 8 }, end: { x: W - lx, y: y + 8 }, thickness: 0.6, color: RULE });
    if (it.owner) {
      y -= 14;
      center(`${t.owner} ${it.owner}`, y, display, 13);
      y -= 8;
    }

    // Declaración
    y -= 20;
    const words = t.statement(it.brand).split(" ");
    let line = "";
    const max = W - 2 * 120;
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (light.widthOfTextAtSize(next, 8.5) > max) {
        center(line, y, light, 8.5, INK);
        y -= 12.5;
        line = w;
      } else line = next;
    }
    if (line) center(line, y, light, 8.5, INK);

    // Firma
    const sy = 92;
    page.drawLine({ start: { x: W / 2 - 110, y: sy + 14 }, end: { x: W / 2 + 110, y: sy + 14 }, thickness: 0.8, color: INK });
    center(t.sign, sy, light, 8, GRAY);
    center([s.doc_address.replace(/\n/g, " · "), s.doc_phone].filter(Boolean).join(" · "), 50, light, 7, GRAY);
  }
  return pdf.save();
}

// Datos de los relojes (del inventario y su ficha de la web, para la foto)
export async function certItems(itemIds: string[], owner: string | null) {
  if (!itemIds.length) return [];
  const db = adminDb();
  const { data } = await db.from("inventory_items").select("id, sku, brand, model, reference, serial, papers_date, condition, comes_with, sale_date, buyer_name, watch_id").in("id", itemIds);
  const watchIds = (data ?? []).map((i) => i.watch_id).filter(Boolean) as string[];
  const { data: watches } = watchIds.length ? await db.from("watches").select("id, images").in("id", watchIds) : { data: [] };
  // Las fotos de las fichas antiguas son rutas de la web (/watches/…): se piden a la web publicada
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://theheuresociety.vercel.app").replace(/\/$/, "");
  const abs = (u: string) => (u.startsWith("http") ? u : u.startsWith("/") ? `${site}${u}` : null);
  const photo = new Map((watches ?? []).map((w) => [w.id as string, ((w.images as string[]) ?? []).map(abs).find(Boolean) ?? null]));
  return (data ?? []).map((i) => ({
    sku: i.sku, brand: i.brand, model: i.model, reference: i.reference, serial: i.serial, papers_date: i.papers_date,
    condition: i.condition, comes_with: i.comes_with, photo: i.watch_id ? photo.get(i.watch_id) ?? null : null,
    owner: owner ?? i.buyer_name ?? null, date: i.sale_date ?? new Date().toISOString().slice(0, 10),
  })) as CertItem[];
}
