import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import sharp from "sharp";
import { z } from "zod";

// Recorte automático para el estuche de la web, en tres pasos:
// 1. Claude elige la mejor foto y sitúa el reloj: caja, centro de la esfera, radio y hacia dónde
//    apuntan las 12 (las fotos suelen estar hechas en la mano, con otros relojes detrás).
// 2. SAM 2 (fal.ai) separa ese reloj del fondo, guiado por esa caja y ese punto.
// 3. Se endereza, se escala a su tamaño real y se centra en el lienzo común del estuche:
//    600×1200 transparente, 9,3 px por mm (igual que los recortes hechos a mano).

const W = 600;
const H = 1200;
const PX_PER_MM = 9.3;

export const cutoutConfigured = Boolean(process.env.FAL_KEY);

// ───────────────────────── 1. Localizar el reloj ─────────────────────────
const LocateSchema = z.object({
  usable: z.boolean(),
  reason: z.string(),
  photo: z.number().int(),
  box: z.object({ x0: z.number(), y0: z.number(), x1: z.number(), y1: z.number() }),
  center: z.object({ x: z.number(), y: z.number() }),
  radius: z.number(),
  angle: z.number(),
});
type Locate = z.infer<typeof LocateSchema>;

const LOCATE = `Preparas recortes de relojes para un estuche virtual: se ve el reloj desde arriba, con la esfera de frente y las 12 hacia arriba. Recibes las fotos de un reloj, numeradas desde 1, con su tamaño en píxeles. Elige la foto que mejor sirve y localiza el reloj en ella.

Una foto sirve si la esfera se ve de frente o casi (no de lado ni muy inclinada), la caja está entera y sin dedos encima, y se ve algo de brazalete o correa. Puede estar en la mano o haber otros relojes al fondo: localiza solo el reloj principal. Si ninguna sirve, usable = false y explica en "reason", en español y en una frase, qué foto haría falta.

Coordenadas en píxeles de la foto elegida (origen arriba a la izquierda):
- box: rectángulo que contiene el reloj principal entero tal como se ve (caja, corona y todo el brazalete o correa visible), sin incluir la mano ni otros relojes.
- center: centro exacto de la esfera.
- radius: radio de la caja medido desde el centro hasta el canto de la caja a la altura de las 9 (el lado opuesto a la corona), en píxeles.
- angle: hacia dónde apuntan las 12 de la esfera, en grados en el sentido de las agujas del reloj desde la vertical hacia arriba de la foto (0 = las 12 arriba, 90 = a la derecha, -90 = a la izquierda, 180 = abajo). Fíjate en el logotipo y en los índices para saberlo.
- photo: número de la foto elegida.
- reason: en español, breve.`;

const client = new Anthropic();

// Claude ve las fotos a esta resolución (por encima, la API las reduce y las coordenadas no cuadrarían)
async function forVision(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No se pudo descargar la foto (${res.status})`);
  const original = Buffer.from(await res.arrayBuffer());
  const meta = await sharp(original).rotate().metadata();
  const w0 = meta.autoOrient?.width ?? meta.width!;
  const h0 = meta.autoOrient?.height ?? meta.height!;
  const k = Math.min(1, 1344 / Math.max(w0, h0), Math.sqrt(1_150_000 / (w0 * h0)));
  const width = Math.round(w0 * k);
  const height = Math.round(h0 * k);
  const jpeg = await sharp(original).rotate().resize(width, height).jpeg({ quality: 88 }).toBuffer();
  return { original, w0, h0, width, height, k, jpeg };
}

export async function locateWatch(photoUrls: string[]) {
  const photos = await Promise.all(photoUrls.slice(0, 6).map(forVision));
  const response = await client.beta.messages.parse({
    model: "claude-opus-5-5",
    max_tokens: 8000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(LocateSchema) },
    system: LOCATE,
    messages: [
      {
        role: "user",
        content: photos.flatMap((p, i) => [
          { type: "text" as const, text: `Foto ${i + 1}: ${p.width}×${p.height} px` },
          { type: "image" as const, source: { type: "base64" as const, media_type: "image/jpeg" as const, data: p.jpeg.toString("base64") } },
        ]),
      },
    ],
  });
  const loc = response.parsed_output;
  if (!loc) throw new Error("La IA no pudo localizar el reloj.");
  const photo = photos[Math.min(Math.max(loc.photo, 1), photos.length) - 1];
  // Coordenadas de vuelta a la resolución original
  const s = 1 / photo.k;
  const scaled: Locate = {
    ...loc,
    box: { x0: loc.box.x0 * s, y0: loc.box.y0 * s, x1: loc.box.x1 * s, y1: loc.box.y1 * s },
    center: { x: loc.center.x * s, y: loc.center.y * s },
    radius: loc.radius * s,
  };
  return { loc: scaled, photo, url: photoUrls[photos.indexOf(photo)] };
}

// ───────────────────────── 2. Separar el reloj del fondo ─────────────────────────
// Devuelve la máscara (un byte por píxel, 0–255) a la resolución original de la foto
async function segment(photo: { original: Buffer; w0: number; h0: number }, loc: Locate) {
  // La foto se envía ya orientada (sin metadatos EXIF de giro), para que las coordenadas coincidan
  const upright = await sharp(photo.original).rotate().jpeg({ quality: 92 }).toBuffer();
  const clamp = (v: number, max: number) => Math.round(Math.min(Math.max(v, 0), max - 1));
  const res = await fetch("https://fal.run/fal-ai/sam2/image", {
    method: "POST",
    headers: { Authorization: `Key ${process.env.FAL_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      image_url: `data:image/jpeg;base64,${upright.toString("base64")}`,
      prompts: [{ x: clamp(loc.center.x, photo.w0), y: clamp(loc.center.y, photo.h0), label: 1 }],
      box_prompts: [
        {
          x_min: clamp(loc.box.x0, photo.w0),
          y_min: clamp(loc.box.y0, photo.h0),
          x_max: clamp(loc.box.x1, photo.w0),
          y_max: clamp(loc.box.y1, photo.h0),
        },
      ],
      output_format: "png",
      sync_mode: true,
    }),
  });
  if (!res.ok) throw new Error(`El servicio de recorte respondió ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const out = (await res.json()) as { image: { url: string } };
  const src = out.image.url.startsWith("data:")
    ? Buffer.from(out.image.url.split(",")[1], "base64")
    : Buffer.from(await (await fetch(out.image.url)).arrayBuffer());

  // La máscara puede venir en blanco y negro o como transparencia: se usa lo que tenga información
  const img = sharp(src).resize(photo.w0, photo.h0, { fit: "fill" });
  const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const n = info.width * info.height;
  const alpha = Buffer.alloc(n);
  const luma = Buffer.alloc(n);
  let alphaVaries = false;
  for (let i = 0; i < n; i++) {
    const a = data[i * 4 + 3];
    alpha[i] = a;
    luma[i] = (data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2]) / 3;
    if (a < 250) alphaVaries = true;
  }
  return keepLargest(alphaVaries ? alpha : luma, info.width, info.height);
}

// Se queda solo con la pieza más grande de la máscara (el reloj) y borra motas sueltas
function keepLargest(mask: Buffer, w: number, h: number) {
  const label = new Int32Array(w * h);
  const stack = new Int32Array(w * h);
  let best = 0;
  let bestSize = 0;
  let next = 0;
  for (let start = 0; start < mask.length; start++) {
    if (mask[start] <= 127 || label[start]) continue;
    next++;
    let size = 0;
    let top = 0;
    stack[top++] = start;
    label[start] = next;
    while (top) {
      const i = stack[--top];
      size++;
      const x = i % w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (j >= 0 && j < mask.length && !label[j] && mask[j] > 127) {
          label[j] = next;
          stack[top++] = j;
        }
      }
    }
    if (size > bestSize) {
      bestSize = size;
      best = next;
    }
  }
  for (let i = 0; i < mask.length; i++) if (label[i] !== best) mask[i] = 0;
  return mask;
}

// ───────────────────────── 3. Afinar la geometría con la máscara ─────────────────────────
// Ajusta un círculo al canto de la caja: rayos desde el centro hacia las 9 y las 3 (evitando
// la corona y las asas), hasta donde termina la máscara.
function refineCircle(mask: Buffer, w: number, h: number, loc: Locate) {
  const inside = (x: number, y: number) => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    return xi >= 0 && yi >= 0 && xi < w && yi < h && mask[yi * w + xi] > 127;
  };
  const up = (loc.angle * Math.PI) / 180; // dirección de las 12
  const pts: [number, number][] = [];
  // Ángulos medidos desde las 3 (0°) en sentido horario: 9 h ± 35°, 3 h entre 15° y 35°
  const rays = [...range(145, 215, 5), ...range(15, 35, 5), ...range(-35, -15, 5)];
  for (const deg of rays) {
    const a = up + Math.PI / 2 + (deg * Math.PI) / 180;
    const dx = Math.sin(a);
    const dy = -Math.cos(a);
    let r = loc.radius * 0.5;
    if (!inside(loc.center.x + dx * r, loc.center.y + dy * r)) continue;
    while (r < loc.radius * 1.6 && inside(loc.center.x + dx * r, loc.center.y + dy * r)) r += 1;
    if (r < loc.radius * 1.6) pts.push([loc.center.x + dx * r, loc.center.y + dy * r]);
  }
  if (pts.length < 8) return null;

  let fit = fitCircle(pts);
  // Se descartan los puntos que se desvían (un dedo, un reflejo) y se ajusta de nuevo
  const good = pts.filter(([x, y]) => Math.abs(Math.hypot(x - fit.x, y - fit.y) - fit.r) < fit.r * 0.06);
  if (good.length >= 6) fit = fitCircle(good);

  const shift = Math.hypot(fit.x - loc.center.x, fit.y - loc.center.y);
  if (Math.abs(fit.r / loc.radius - 1) > 0.25 || shift > loc.radius * 0.3) return null;
  return fit;
}

// Afina hacia dónde apuntan las 12 con el eje de asas y brazalete (de las 12 a las 6),
// que en la máscara es la dirección más alargada alrededor de la caja
function refineAngle(mask: Buffer, w: number, h: number, c: { x: number; y: number; r: number }, estimate: number) {
  let n = 0, sxx = 0, syy = 0, sxy = 0;
  const r0 = c.r * 1.2;
  const r1 = c.r * 2.2;
  for (let y = Math.max(0, Math.floor(c.y - r1)); y < Math.min(h, c.y + r1); y += 2) {
    for (let x = Math.max(0, Math.floor(c.x - r1)); x < Math.min(w, c.x + r1); x += 2) {
      const dx = x - c.x;
      const dy = y - c.y;
      const d = Math.hypot(dx, dy);
      if (d < r0 || d > r1 || mask[y * w + x] <= 127) continue;
      n++; sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
    }
  }
  if (n < 500) return null;
  // Eje principal de la nube de puntos y cuánto más largo es que ancho
  const tr = sxx + syy;
  const det = sxx * syy - sxy * sxy;
  const l1 = tr / 2 + Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const l2 = tr - l1;
  if (l1 < l2 * 2) return null;
  const axis = (Math.atan2(l1 - sxx, sxy) * 180) / Math.PI; // dirección (dx, dy) = (sxy, l1 - sxx)
  // Convertir a «grados desde arriba en sentido horario» y elegir el sentido más cercano a la estimación
  const up = 90 + axis;
  const diff = (a: number) => Math.abs(((a - estimate + 540) % 360) - 180);
  const best = diff(up) < diff(up + 180) ? up : up + 180;
  if (diff(best) > 15) return null;
  return estimate + (((best - estimate + 540) % 360) - 180);
}

function range(from: number, to: number, step: number) {
  const out: number[] = [];
  for (let v = from; v <= to; v += step) out.push(v);
  return out;
}

// Círculo por mínimos cuadrados (método de Kåsa)
function fitCircle(pts: [number, number][]) {
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, sz = 0;
  for (const [x, y] of pts) {
    const z = x * x + y * y;
    sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; sxz += x * z; syz += y * z; sz += z;
  }
  const n = pts.length;
  // Sistema 3×3: [sxx sxy sx; sxy syy sy; sx sy n] · [a b c] = [sxz syz sz]
  const m = [
    [sxx, sxy, sx, sxz],
    [sxy, syy, sy, syz],
    [sx, sy, n, sz],
  ];
  for (let i = 0; i < 3; i++) {
    const p = m[i][i];
    for (let j = i; j < 4; j++) m[i][j] /= p;
    for (let k = 0; k < 3; k++) {
      if (k === i) continue;
      const f = m[k][i];
      for (let j = i; j < 4; j++) m[k][j] -= f * m[i][j];
    }
  }
  const [a, b, c] = [m[0][3], m[1][3], m[2][3]];
  const x = a / 2;
  const y = b / 2;
  return { x, y, r: Math.sqrt(c + x * x + y * y) };
}

// ───────────────────────── 4. Componer el recorte ─────────────────────────
async function compose(photo: { original: Buffer; w0: number; h0: number }, mask: Buffer, c: { x: number; y: number; r: number }, angle: number, mm: number) {
  const scale = ((mm / 2) * PX_PER_MM) / c.r;
  // Recuadro alrededor del centro que, una vez escalado, cubre el lienzo aunque se gire
  const half = Math.ceil(Math.hypot(W, H) / 2 / scale) + 4;
  const side = half * 2;

  const softMask = await sharp(mask, { raw: { width: photo.w0, height: photo.h0, channels: 1 } }).blur(0.8).extractChannel(0).raw().toBuffer();
  const rgb = await sharp(photo.original).rotate().removeAlpha().raw().toBuffer();
  const rgba = await sharp(rgb, { raw: { width: photo.w0, height: photo.h0, channels: 3 } })
    .joinChannel(softMask, { raw: { width: photo.w0, height: photo.h0, channels: 1 } })
    .png()
    .toBuffer();

  // Recuadro centrado en el reloj (con relleno transparente si se sale de la foto)
  const left = Math.round(c.x) - half;
  const top = Math.round(c.y) - half;
  const pad = { top: Math.max(0, -top), left: Math.max(0, -left), bottom: Math.max(0, top + side - photo.h0), right: Math.max(0, left + side - photo.w0) };
  // (en dos pasos: dentro de una misma cadena sharp recorta antes de ampliar)
  const padded = await sharp(rgba).extend({ ...pad, background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const square = await sharp(padded)
    .extract({ left: left + pad.left, top: top + pad.top, width: side, height: side })
    .png()
    .toBuffer();

  // Enderezar (las 12 arriba), escalar a tamaño real y recortar el lienzo del estuche
  const rotated = await sharp(square).rotate(-angle, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const rm = await sharp(rotated).metadata();
  const sized = Math.round(rm.width! * scale);
  const resized = await sharp(rotated).resize(sized, sized, { kernel: "lanczos3" }).png().toBuffer();
  return sharp(resized)
    .extract({ left: Math.round(sized / 2 - W / 2), top: Math.round(sized / 2 - H / 2), width: W, height: H })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

// Vista previa para Telegram: el recorte sobre el verde del estuche
export async function cutoutPreview(png: Buffer) {
  return sharp({ create: { width: W, height: H, channels: 3, background: "#173a2a" } })
    .composite([{ input: png }])
    .jpeg({ quality: 85 })
    .toBuffer();
}

export type CutoutResult = { ok: true; png: Buffer; source: string } | { ok: false; reason: string };

export async function makeCutout(photoUrls: string[], caseSize: string): Promise<CutoutResult> {
  const mm = parseFloat(caseSize.replace(",", "."));
  if (!mm || mm < 20 || mm > 60) return { ok: false, reason: `No sé el diámetro de la caja («${caseSize}»).` };

  const { loc, photo, url } = await locateWatch(photoUrls);
  if (!loc.usable) return { ok: false, reason: loc.reason };

  const mask = await segment(photo, loc);
  const fit = refineCircle(mask, photo.w0, photo.h0, loc);
  const circle = fit ?? { x: loc.center.x, y: loc.center.y, r: loc.radius };
  const angle = refineAngle(mask, photo.w0, photo.h0, circle, loc.angle) ?? loc.angle;
  const png = await compose(photo, mask, circle, angle, mm);
  return { ok: true, png, source: url };
}
