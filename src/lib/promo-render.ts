import "server-only";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { adminDb, PHOTO_BUCKET } from "./supabase";
import { promoOverlay } from "./promo-overlay";
import { escapeHtml as h, keyboard, sendMessage, sendVideoFile } from "./telegram";
import {
  auth, CLIP, dropState, H, handOff, HOLD, loadState, priceText, saveState, scenes, submit, VIDEO_MODEL, W, WATCH_COLS, DEFAULT_OPENING, DEFAULT_SCENARIO, label,
  type Job, type Row, type Watch,
} from "./promo-video";

// Segunda mitad del video promocional: esperar a Higgsfield y montar el video con ffmpeg (el binario pesa
// ~80 MB). Vive aparte para que solo lo cargue la ruta /api/promo-video/poll y no el robot de Telegram ni
// el panel, y así sus funciones no lleven ffmpeg dentro.

type Status = {
  status?: string;
  images?: { url?: string }[];
  video?: { url?: string };
  error?: string;
};
// Actualiza las peticiones pendientes; devuelve true cuando ya no queda ninguna
async function check(jobs: Job[]) {
  for (const j of jobs) {
    if (j.result || j.failed) continue;
    const s = (await (await fetch(j.url, { headers: auth() })).json().catch(() => ({}))) as Status;
    if (s.status === "completed") {
      j.result = s.video?.url ?? s.images?.[0]?.url;
      if (!j.result) j.failed = true;
    } else if (s.status === "failed" || s.status === "nsfw" || s.status === "canceled") j.failed = true;
  }
  return jobs.every((j) => j.result || j.failed);
}

async function fail(row: Row, reason: string) {
  await adminDb()
    .from("promo_videos")
    .update({
      status: "failed",
      error: reason.slice(0, 500),
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id);
  await dropState(row.id);
  if (row.chat_id) await sendMessage(row.chat_id, `⚠️ No se pudo generar el video promocional (${h(reason.slice(0, 200))}). Puedes intentarlo otra vez desde ⌚ Inventario → 🎬 Video promocional.`);
}

// Espera (hasta `budgetMs`) a los fotogramas y luego a las tomas; si aún no están, pasa el testigo
export async function pollPromoVideo(id: string, budgetMs: number, hop = 0) {
  const db = adminDb();
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    const { data } = await db.from("promo_videos").select("id, watch_id, chat_id, status").eq("id", id).single();
    const row = data as Row;
    if (!row || row.status !== "queued") return;
    const st = await loadState(id);
    if (!st) return fail(row, "estado perdido");

    if (st.stage === "images" && (await check(st.images))) {
      // Las tomas se animan desde los fotogramas; si alguno falló, desde la foto original
      const { data: wd } = await db.from("watches").select(WATCH_COLS).eq("id", row.watch_id).single();
      const sc = scenes(wd as Watch, st.opening, st.scenario);
      try {
        st.videos = await Promise.all(
          st.images.map(async (img, i) => ({
            url: await submit(
              VIDEO_MODEL,
              {
                image_url: img.result ?? st.source,
                prompt: sc[i].motion,
                duration: CLIP,
                cfg_scale: 0.6,
                negative_prompt: "warped dial, melting, distorted text, extra hands, morphing, blur, flicker, logo, watermark",
              },
              `${id}-vid${i}`,
            ),
          })),
        );
      } catch (e) {
        return fail(row, (e as Error).message);
      }
      st.stage = "videos";
      await saveState(id, st);
    } else if (st.stage === "videos" && (await check(st.videos))) {
      const clips = st.videos.map((v) => v.result).filter(Boolean) as string[];
      if (!clips.length) return fail(row, "Higgsfield no devolvió las tomas");
      await db
        .from("promo_videos")
        .update({ raw_url: clips.join(" ") })
        .eq("id", id);
      // El montaje necesita su propia invocación con tiempo de sobra
      if (deadline - Date.now() < 150_000) return handOff(id, hop + 1);
      return finishPromoVideo(row, clips, st.opening, st.scenario);
    } else {
      await saveState(id, st);
    }
    await new Promise((r) => setTimeout(r, 8_000));
  }
  if (hop < 10) await handOff(id, hop + 1);
}

const run = promisify(execFile);

// En Vercel la ruta que calcula ffmpeg-static dentro del bundle no existe: se busca el binario a mano
async function ffmpegPath() {
  const local = join(process.cwd(), "node_modules", "ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
  if (existsSync(local)) return local;
  return (await import("ffmpeg-static")).default as unknown as string;
}

// Monta las tomas en `dir`: fundido entre ellas, la última se congela un momento y encima aparece el texto de la marca
export async function renderPromo(w: Watch, clips: string[], dir: string) {
  const files = await Promise.all(
    clips.map(async (u, i) => {
      const f = join(dir, `clip${i}.mp4`);
      await writeFile(f, Buffer.from(await (await fetch(u)).arrayBuffer()));
      return f;
    }),
  );
  const png = join(dir, "text.png");
  const out = join(dir, "final.mp4");
  await writeFile(png, await promoOverlay({ brand: w.brand, model: w.model, reference: w.reference, price: priceText(w), cta: "Available now · Disponible", handle: "@theheuresociety · (305) 509-5767" }));

  // Pista de audio en silencio: Instagram rechaza a veces los reels sin audio (la música se pone en la app)
  const X = 0.5; // fundido entre tomas
  const n = files.length;
  const norm = files.map((_, i) => `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},trim=0:${CLIP},setpts=PTS-STARTPTS,fps=24,settb=1/24,setsar=1,format=yuv420p[v${i}]`);
  const chain: string[] = [];
  let last = "v0";
  let length = CLIP;
  for (let i = 1; i < n; i++) {
    chain.push(`[${last}][v${i}]xfade=transition=fade:duration=${X}:offset=${(length - X).toFixed(2)}[x${i}]`);
    length += CLIP - X;
    last = `x${i}`;
  }
  // El texto entra a mitad de la última toma (los focos ya encendidos) y se queda en pantalla
  const textAt = Math.max(0, length - CLIP + 1.5);
  chain.push(`[${last}]tpad=stop_mode=clone:stop_duration=${HOLD}[p]`, `[${n}:v]format=rgba,fade=in:st=${textAt.toFixed(2)}:d=0.8:alpha=1[t]`, `[p][t]overlay=0:0:shortest=1,format=yuv420p[out]`);
  length += HOLD;
  const ffmpeg = await ffmpegPath();
  await run(
    ffmpeg,
    ["-y", "-loglevel", "warning", ...files.flatMap((f) => ["-i", f]), "-loop", "1", "-framerate", "24", "-i", png, "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100", "-filter_complex", [...norm, ...chain].join(";"), "-map", "[out]", "-map", `${files.length + 1}:a`, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-b:a", "128k", "-shortest", "-movflags", "+faststart", out],
    { timeout: 180_000 },
  ).catch((e: { stderr?: string; signal?: string; message: string }) => {
    // El mensaje de execFile repite el comando entero: lo útil es lo que dice ffmpeg al final
    throw new Error(`ffmpeg: ${e.signal ? `detenido (${e.signal}) ` : ""}${(e.stderr || e.message).trim().slice(0, 900)}`);
  });
  return { final: await readFile(out), length };
}

async function finishPromoVideo(row: Row, clips: string[], opening = DEFAULT_OPENING, scenario = DEFAULT_SCENARIO) {
  const db = adminDb();
  const { data: locked } = await db.from("promo_videos").update({ status: "rendering" }).eq("id", row.id).eq("status", "queued").select("id").maybeSingle();
  if (!locked) return; // otra invocación ya lo está montando
  const { data } = await db.from("watches").select(WATCH_COLS).eq("id", row.watch_id).single();
  const w = data as Watch;
  const dir = await mkdtemp(join(tmpdir(), "promo-"));
  try {
    const { final, length } = await renderPromo(w, clips, dir);
    const path = `promo/videos/${w.slug}-${Date.now()}.mp4`;
    const bucket = db.storage.from(PHOTO_BUCKET);
    const { error } = await bucket.upload(path, final, {
      contentType: "video/mp4",
      upsert: true,
    });
    if (error) throw error;
    const url = bucket.getPublicUrl(path).data.publicUrl;
    await db
      .from("promo_videos")
      .update({
        status: "done",
        final_url: url,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    await dropState(row.id);
    if (row.chat_id) {
      await sendVideoFile(
        row.chat_id,
        final,
        `${w.slug}.mp4`,
        `🎬 <b>Video promocional</b> · ${h(w.brand)} ${h(w.model)}\n${label(opening)} → ${label(scenario)}\n${Math.round(length)} s vertical para Reels, Stories y anuncios. Va sin sonido: ponle una canción de tendencia al subirlo a Instagram.`,
        {
          reply_markup: keyboard([
            [{ text: "🔁 Otra versión igual", callback_data: `mvid:${w.id}|${opening}|${scenario}` }],
            [{ text: "🎲 Otra al azar", callback_data: `mvid:${w.id}|auto|auto` }],
            [{ text: "🎭 Elegir tomas", callback_data: `mvid:${w.id}` }],
          ]),
        },
      );
    }
  } catch (e) {
    await db
      .from("promo_videos")
      .update({ status: "failed", error: (e as Error).message.slice(0, 1000) })
      .eq("id", row.id);
    if (row.chat_id) await sendMessage(row.chat_id, `⚠️ Las tomas se generaron pero falló el montaje: ${h((e as Error).message.slice(0, 200))}\n${clips.join("\n")}`);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
