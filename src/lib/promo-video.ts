import "server-only";
import { createHmac } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { adminDb, PHOTO_BUCKET } from "./supabase";
import { promoOverlay } from "./promo-overlay";
import { escapeHtml as h, keyboard, sendMessage, sendVideoFile } from "./telegram";

// Video promocional de 15 s (vertical, con sonido) para Instagram y Facebook, de cada reloj nuevo:
// 1. la foto principal se prepara en 9:16 · 2. Higgsfield (Kling 3.0) la anima en 3 tomas
// 3. ffmpeg pone encima el texto de la marca (marca, modelo, precio) · 4. llega por Telegram.
// Se activa con HF_API_KEY_ID y HF_API_KEY_SECRET (API de Higgsfield).

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://theheuresociety.vercel.app").replace(/\/$/, "");
const API = "https://api.higgsfield.ai";
const MODEL = "kling-video/v3.0/std/image-to-video";
const W = 720;
const H = 1280;

export const promoConfigured = () => Boolean(process.env.HF_API_KEY_ID && process.env.HF_API_KEY_SECRET);
const auth = () => ({ Authorization: `Key ${process.env.HF_API_KEY_ID}:${process.env.HF_API_KEY_SECRET}`, "Content-Type": "application/json" });

type Watch = { id: string; slug: string; brand: string; model: string; reference: string; price: number | null; currency: string; images: string[] };
type Row = { id: string; watch_id: string; chat_id: number | null; status: string; request_id: string | null; status_url: string | null };

const priceText = (w: Watch) => (w.price == null ? "Price on request" : `${w.currency === "USD" ? "$" : `${w.currency} `}${Number(w.price).toLocaleString("en-US")}`);

// Las tres tomas: movimiento de cámara lento; el reloj no cambia (para que no se deforme)
const KEEP = "The watch itself stays perfectly still and undistorted: dial text, logo, hands, indices and bracelet remain sharp and exactly as in the photo.";
const shots = (w: Watch) => [
  { prompt: `Slow cinematic push-in towards the ${w.brand} ${w.model} watch. A soft light sweep glides across the dial and polished case. ${KEEP}`, duration: 5 },
  { prompt: `Gentle slow orbit around the watch with shallow depth of field, refined highlights travel over the case and bracelet, luxurious dark green and brass mood. ${KEEP}`, duration: 5 },
  { prompt: `Slow elegant pull-back revealing the whole watch in warm golden light, calm and premium, empty space in the lower part of the frame. ${KEEP}`, duration: 5 },
];

// Foto principal → 720×1280: la foto entera centrada sobre un fondo desenfocado de sí misma
async function verticalStill(w: Watch) {
  const src = w.images.map((u) => (u.startsWith("http") ? u : u.startsWith("/") ? `${SITE}${u}` : null)).find(Boolean);
  if (!src) throw new Error("El reloj no tiene foto");
  const bytes = Buffer.from(await (await fetch(src)).arrayBuffer());
  const bg = await sharp(bytes).resize(W, H, { fit: "cover" }).blur(28).modulate({ brightness: 0.55 }).toBuffer();
  const fg = await sharp(bytes).resize(W, Math.round(H * 0.82), { fit: "inside" }).toBuffer();
  const meta = await sharp(fg).metadata();
  const img = await sharp(bg)
    .composite([{ input: fg, left: Math.round((W - (meta.width ?? W)) / 2), top: Math.round((H * 0.9 - (meta.height ?? H)) / 2) }])
    .jpeg({ quality: 90 })
    .toBuffer();
  const path = `promo/inputs/${w.slug}-${Date.now()}.jpg`;
  const bucket = adminDb().storage.from(PHOTO_BUCKET);
  const { error } = await bucket.upload(path, img, { contentType: "image/jpeg", upsert: true });
  if (error) throw error;
  return bucket.getPublicUrl(path).data.publicUrl;
}

const pollToken = (id: string) => createHmac("sha256", process.env.CRON_SECRET ?? "").update(`promo:${id}`).digest("hex").slice(0, 24);
export const validPollToken = (id: string, k: string) => Boolean(process.env.CRON_SECRET) && k === pollToken(id);

// Sigue esperando en otra invocación (Higgsfield tarda varios minutos y cada función tiene un límite)
function handOff(id: string, hop: number) {
  return fetch(`${SITE}/api/promo-video/poll?id=${id}&k=${pollToken(id)}&hop=${hop}`, { signal: AbortSignal.timeout(4000) }).catch(() => {});
}

export async function startPromoVideo(watchId: string, chatId: number | null) {
  const db = adminDb();
  const { data } = await db.from("watches").select("id, slug, brand, model, reference, price, currency, images").eq("id", watchId).single();
  const w = data as Watch;
  const input = await verticalStill(w);
  const { data: row, error } = await db.from("promo_videos").insert({ watch_id: w.id, chat_id: chatId, input_url: input }).select("id").single();
  if (error) throw error;
  const res = await fetch(`${API}/${MODEL}`, {
    method: "POST",
    headers: { ...auth(), "Idempotency-Key": row.id },
    body: JSON.stringify({
      image_url: input,
      prompt: `Luxury watch commercial for The Heure Society: ${w.brand} ${w.model}. Cinematic, elegant, slow camera moves. ${KEEP} Subtle refined ambient music and a soft mechanical ticking, no voices.`,
      duration: 15,
      sound: "on",
      multi_shots: true,
      multi_prompt: shots(w),
    }),
  });
  const json = (await res.json().catch(() => ({}))) as { request_id?: string; status_url?: string; detail?: unknown };
  if (!res.ok || !json.request_id) {
    await db.from("promo_videos").update({ status: "failed", error: JSON.stringify(json.detail ?? json).slice(0, 500) }).eq("id", row.id);
    throw new Error(`Higgsfield: ${JSON.stringify(json.detail ?? json).slice(0, 200)}`);
  }
  await db.from("promo_videos").update({ request_id: json.request_id, status_url: json.status_url ?? `${API}/requests/${json.request_id}/status`, updated_at: new Date().toISOString() }).eq("id", row.id);
  return row.id as string;
}

// Espera el video (hasta `budgetMs`); si aún no está, pasa el testigo a otra invocación
export async function pollPromoVideo(id: string, budgetMs: number, hop = 0) {
  const db = adminDb();
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    const { data } = await db.from("promo_videos").select("*").eq("id", id).single();
    const row = data as Row;
    if (!row || row.status === "done" || row.status === "failed" || row.status === "rendering") return;
    const res = await fetch(row.status_url!, { headers: auth() });
    const s = (await res.json().catch(() => ({}))) as { status?: string; video?: { url?: string }; error?: string };
    if (s.status === "completed" && s.video?.url) return finishPromoVideo(row, s.video.url);
    if (s.status === "failed" || s.status === "nsfw" || s.status === "canceled") {
      await db.from("promo_videos").update({ status: "failed", error: s.error ?? s.status }).eq("id", id);
      if (row.chat_id) await sendMessage(row.chat_id, `⚠️ No se pudo generar el video promocional (${h(s.error ?? s.status ?? "error")}). Puedes intentarlo otra vez desde ⌚ Inventario → 🎬 Video promocional.`);
      return;
    }
    await new Promise((r) => setTimeout(r, 10_000));
  }
  if (hop < 8) await handOff(id, hop + 1);
}

const run = promisify(execFile);

// Texto de la marca encima de los últimos 5,5 s (aparece suave) y el sonido original
async function finishPromoVideo(row: Row, videoUrl: string) {
  const db = adminDb();
  const { error: lockErr, data: locked } = await db.from("promo_videos").update({ status: "rendering", raw_url: videoUrl }).eq("id", row.id).eq("status", "queued").select("id").maybeSingle();
  if (lockErr || !locked) return; // otra invocación ya lo está montando
  const { data } = await db.from("watches").select("id, slug, brand, model, reference, price, currency, images").eq("id", row.watch_id).single();
  const w = data as Watch;
  const dir = await mkdtemp(join(tmpdir(), "promo-"));
  try {
    const raw = join(dir, "raw.mp4");
    const png = join(dir, "text.png");
    const out = join(dir, "final.mp4");
    await writeFile(raw, Buffer.from(await (await fetch(videoUrl)).arrayBuffer()));
    await writeFile(png, await promoOverlay({ brand: w.brand, model: w.model, reference: w.reference, price: priceText(w), cta: "Available now · Disponible", handle: "@theheuresociety · (305) 509-5767" }));
    const ffmpeg = (await import("ffmpeg-static")).default as unknown as string;
    await run(ffmpeg, [
      "-y", "-i", raw, "-loop", "1", "-i", png,
      "-filter_complex", "[1:v][0:v]scale2ref[t][v];[t]format=rgba,fade=in:st=9.5:d=0.8:alpha=1[o];[v][o]overlay=0:0:shortest=1,format=yuv420p[out]",
      "-map", "[out]", "-map", "0:a?", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", out,
    ], { timeout: 180_000 });
    const final = await readFile(out);
    const path = `promo/videos/${w.slug}-${Date.now()}.mp4`;
    const bucket = db.storage.from(PHOTO_BUCKET);
    const { error } = await bucket.upload(path, final, { contentType: "video/mp4", upsert: true });
    if (error) throw error;
    const url = bucket.getPublicUrl(path).data.publicUrl;
    await db.from("promo_videos").update({ status: "done", final_url: url, updated_at: new Date().toISOString() }).eq("id", row.id);
    if (row.chat_id) {
      await sendVideoFile(row.chat_id, final, `${w.slug}.mp4`, `🎬 <b>Video promocional</b> · ${h(w.brand)} ${h(w.model)}\n15 s vertical para Reels, Stories y anuncios. Guárdalo y publícalo, o pide otra versión.`, {
        reply_markup: keyboard([[{ text: "🔁 Otra versión", callback_data: `mvid:${w.id}` }]]),
      });
    }
  } catch (e) {
    await db.from("promo_videos").update({ status: "failed", error: (e as Error).message.slice(0, 500) }).eq("id", row.id);
    if (row.chat_id) await sendMessage(row.chat_id, `⚠️ El video se generó pero falló el montaje: ${h((e as Error).message.slice(0, 200))}\nVideo sin texto: ${videoUrl}`);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
