import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import opentype from "opentype.js";
import sharp from "sharp";

// Capa de texto del video promocional (PNG transparente 720×1280): marca, modelo, referencia,
// precio y llamada a la acción. El texto se dibuja con las fuentes de la marca convertidas en
// trazos, así no depende de las fuentes del servidor y nunca sale deformado (no lo hace la IA).

const ASSETS = join(process.cwd(), "src/lib/pdf-assets");
let fonts: Promise<{ display: opentype.Font; sans: opentype.Font; light: opentype.Font }> | null = null;
const loadFonts = () =>
  (fonts ??= Promise.all(["cormorant.ttf", "montserrat.ttf", "montserrat-light.ttf"].map((f) => readFile(join(ASSETS, f)))).then(([d, s, l]) => ({
    display: opentype.parse(d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength) as ArrayBuffer),
    sans: opentype.parse(s.buffer.slice(s.byteOffset, s.byteOffset + s.byteLength) as ArrayBuffer),
    light: opentype.parse(l.buffer.slice(l.byteOffset, l.byteOffset + l.byteLength) as ArrayBuffer),
  })));

const W = 720;
const H = 1280;

// Trazo SVG propio: toPathData() de la librería a veces escribe «NaN» al redondear
const n = (v: number) => (Math.round(v * 100) / 100).toString();
function pathData(p: opentype.Path) {
  return p.commands
    .map((c) =>
      c.type === "M" || c.type === "L" ? `${c.type}${n(c.x)} ${n(c.y)}`
      : c.type === "Q" ? `Q${n(c.x1)} ${n(c.y1)} ${n(c.x)} ${n(c.y)}`
      : c.type === "C" ? `C${n(c.x1)} ${n(c.y1)} ${n(c.x2)} ${n(c.y2)} ${n(c.x)} ${n(c.y)}`
      : "Z"
    )
    .join("");
}

// Texto centrado como trazo SVG, letra a letra (al componer palabras enteras la librería da
// coordenadas inválidas con estas fuentes); se reduce si no cabe
function centered(font: opentype.Font, text: string, y: number, size: number, fill: string, track = 0, maxWidth = W - 80) {
  const chars = [...text.normalize("NFC")];
  const width = (s: number) => chars.reduce((a, ch) => a + font.getAdvanceWidth(ch, s, { kerning: false }), 0) + track * Math.max(0, chars.length - 1);
  while (size > 10 && width(size) > maxWidth) size -= 1;
  let x = (W - width(size)) / 2;
  let d = "";
  for (const ch of chars) {
    d += pathData(font.getPath(ch, x, y, size, { kerning: false }));
    x += font.getAdvanceWidth(ch, size, { kerning: false }) + track;
  }
  return d ? `<path d="${d}" fill="${fill}"/>` : "";
}

export type PromoText = { brand: string; model: string; reference: string; price: string; cta: string; handle: string };

export async function promoOverlay(t: PromoText) {
  return sharp(Buffer.from(await promoOverlaySvg(t))).png().toBuffer();
}

export async function promoOverlaySvg(t: PromoText) {
  const { display, sans, light } = await loadFonts();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#0b100d" stop-opacity="0"/>
    <stop offset="0.35" stop-color="#0b100d" stop-opacity="0.78"/>
    <stop offset="1" stop-color="#0b100d" stop-opacity="0.96"/>
  </linearGradient></defs>
  <rect x="0" y="${H - 560}" width="${W}" height="560" fill="url(#g)"/>
  ${centered(sans, "THE HEURE SOCIETY", H - 372, 15, "#c8b07a", 6)}
  ${centered(display, t.brand.toUpperCase(), H - 312, 44, "#f1ece2", 5)}
  ${centered(display, t.model, H - 258, 40, "#f1ece2")}
  ${centered(light, t.reference ? `REF. ${t.reference.toUpperCase()}` : "", H - 216, 17, "#a8b0a9", 3)}
  <rect x="${W / 2 - 40}" y="${H - 190}" width="80" height="1.5" fill="#c8b07a"/>
  ${centered(display, t.price, H - 140, 38, "#f1ece2")}
  ${centered(sans, t.cta.toUpperCase(), H - 92, 15, "#c8b07a", 3.5)}
  ${centered(light, t.handle, H - 58, 15, "#a8b0a9", 1)}
</svg>`;
  return svg;
}
