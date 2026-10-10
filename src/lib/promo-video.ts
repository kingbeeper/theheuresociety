import "server-only";
import { createHmac } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { adminDb, PHOTO_BUCKET } from "./supabase";
import { promoOverlay } from "./promo-overlay";
import { escapeHtml as h, keyboard, sendMessage, sendVideoFile } from "./telegram";

// Video promocional vertical (~11 s) para Reels, Stories y anuncios, al estilo de un spot de lujo:
// 1. Higgsfield Marketing Studio crea dos fotogramas con el reloj: un macro del bisel/corona en estudio
//    y el reloj sobre superficie negra bajo focos (≈ $0,01)
// 2. Kling 2.5 Turbo anima cada uno 5 s (≈ $0,21 cada uno; sin sonido: la música se pone en Instagram)
// 3. ffmpeg los une y, con los focos ya encendidos, hace aparecer el texto de la marca (gratis)
// 4. llega por Telegram. Total ≈ $0,45 por video.
// Se activa con HF_API_KEY_ID y HF_API_KEY_SECRET (API de Higgsfield).

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://theheuresociety.vercel.app").replace(/\/$/, "");
const API = "https://api.higgsfield.ai";
const IMAGE_MODEL = "marketing-studio/image";
const VIDEO_MODEL = "kling-video/v2.5-turbo/standard/image-to-video";
const W = 720;
const H = 1280;
const CLIP = 5; // segundos por toma
const HOLD = 1.5; // la última imagen se queda quieta para leer el texto

export const promoConfigured = () => Boolean(process.env.HF_API_KEY_ID && process.env.HF_API_KEY_SECRET);
const auth = () => ({
  Authorization: `Key ${process.env.HF_API_KEY_ID}:${process.env.HF_API_KEY_SECRET}`,
  "Content-Type": "application/json",
});

type Watch = {
  id: string;
  slug: string;
  brand: string;
  model: string;
  reference: string;
  price: number | null;
  currency: string;
  images: string[];
  cutout: string | null;
};
type Row = {
  id: string;
  watch_id: string;
  chat_id: number | null;
  status: string;
};
// Estado de las peticiones a Higgsfield (en integration_settings, clave promo:<id>)
type Job = { url: string; result?: string; failed?: boolean };
type State = {
  stage: "images" | "videos";
  source: string;
  images: Job[];
  videos: Job[];
  scenario?: string;
};

const priceText = (w: Watch) => (w.price == null ? "Price on request" : `${w.currency === "USD" ? "$" : `${w.currency} `}${Number(w.price).toLocaleString("en-US")}`);
const absolute = (u: string | null | undefined) => (!u ? null : u.startsWith("http") ? u : u.startsWith("/") ? `${SITE}${u}` : null);
const WATCH_COLS = "id, slug, brand, model, reference, price, currency, images, cutout";

// El reloj de la foto tiene que salir idéntico (esfera, logotipo, agujas, brazalete)
const SAME =
  "Use the exact watch from the reference image, identical in every detail: dial color and texture, logo and dial text, hands, indices, bezel, case and strap or bracelet. Photorealistic, high-end luxury watch commercial, cinematic color grading.";
type Shot = { image: string; motion: string };
const STILL = "The watch keeps its exact shape and dial text.";

// Escenarios para la segunda toma (se eligen en Telegram). Todos abren con el mismo macro del bisel
export const SCENARIOS: Record<string, { label: string; shot: (w: Watch) => Shot }> = {
  focos: {
    label: "💡 Focos de estudio",
    shot: (w) => ({
      image: `Hero product shot of the ${w.brand} ${w.model} standing upright on a glossy black reflective surface in a dark luxury studio, warm theatrical spotlights from above create pools of golden light on the watch and a soft mirror reflection below. The watch sits in the upper-middle of the frame; the lower third is empty dark space. ${SAME}`,
      motion: `In darkness, spotlights switch on one after another and illuminate the watch, light glints travel across the polished case and crystal, very slow push-in, camera steady. ${STILL}`,
    }),
  },
  terciopelo: {
    label: "🟢 Terciopelo verde y latón",
    shot: (w) => ({
      image: `The ${w.brand} ${w.model} resting on deep emerald green velvet with polished brass details, in a refined jewelry-boutique setting, soft warm directional light, rich shadows, elegant and quiet luxury. The watch sits in the upper-middle of the frame; the lower third is dark velvet. ${SAME}`,
      motion: `A soft beam of warm light slowly travels across the velvet and onto the watch, gentle slow orbit and push-in, dust particles glinting in the light. ${STILL}`,
    }),
  },
  marmol: {
    label: "🥃 Mármol, whisky y puro",
    shot: (w) => ({
      image: `Luxury still life: the ${w.brand} ${w.model} lying on a black marble table next to a crystal glass of whisky with a large ice cube, a cigar on a brass ashtray and a leather notebook, warm low-key lighting of a private members' lounge, shallow depth of field, the watch in sharp focus in the upper-middle of the frame, darker space below. ${SAME}`,
      motion: `Very slow cinematic dolly-in towards the watch, a thin ribbon of cigar smoke drifts through the warm light, ice gently shifts in the glass. ${STILL}`,
    }),
  },
  traje: {
    label: "🕴️ Traje y ciudad de noche",
    shot: (w) => ({
      image: `Close-up of a man in a tailored dark navy suit and crisp white shirt adjusting his cuff, revealing the ${w.brand} ${w.model} on his wrist, standing by a floor-to-ceiling window of a penthouse with the Miami skyline glittering at night behind, moody cinematic lighting. ${SAME}`,
      motion: `The man slowly adjusts his shirt cuff to reveal the watch, the camera gently pushes in, city lights shimmer in soft bokeh behind. ${STILL}`,
    }),
  },
  miami: {
    label: "🌴 Al volante en Miami Beach",
    shot: (w) => ({
      image: `First-person view from the driver's seat of a luxury convertible sports car cruising along Ocean Drive in Miami Beach at golden hour: a man's tanned left wrist wearing the ${w.brand} ${w.model} rests on the steering wheel, pastel Art Deco hotels, palm trees and the turquoise ocean softly out of focus behind, warm sunset light catching the watch. No visible car brand logos. ${SAME}`,
      motion: `The car cruises slowly along the beach road while the camera gently pushes in towards the watch on the wrist; palm trees and the ocean drift by in the soft-focus background, warm golden sunlight flickers on the dial. ${STILL}`,
    }),
  },
  yate: {
    label: "⛵ Yate al atardecer",
    shot: (w) => ({
      image: `A man's tanned wrist wearing the ${w.brand} ${w.model} resting on the polished teak and chrome railing of a luxury yacht in Biscayne Bay at sunset, the Miami skyline and calm golden water softly out of focus behind, linen shirt sleeve rolled up, warm cinematic light. ${SAME}`,
      motion: `The yacht glides gently over the water, the camera slowly pushes in to the watch on the wrist, golden reflections ripple on the water and sparkle on the case. ${STILL}`,
    }),
  },
  agua: {
    label: "💧 Agua y salpicaduras",
    shot: (w) => ({
      image: `The ${w.brand} ${w.model} in dramatic slow motion with crystal-clear water splashing around it and droplets on the crystal and case, dark background with cool rim lighting, high-speed commercial photography. The watch sits in the upper-middle of the frame. ${SAME}`,
      motion: `Super slow motion: water splashes and droplets burst around the watch and fall away, light glints on the wet case, camera steady with a slight push-in. ${STILL}`,
    }),
  },
};
export const DEFAULT_SCENARIO = "focos";

export const scenes = (w: Watch, scenario = DEFAULT_SCENARIO): Shot[] => [
  {
    image: `Extreme macro close-up of the ${w.brand} ${w.model}: the bezel, crown and edge of the case fill the frame, dramatic studio lighting with glints on polished steel, deep black background, very shallow depth of field. ${SAME}`,
    motion: `Very slow macro camera glide along the bezel and crown, a soft light sweep travels across the polished metal. Smooth, elegant, no cuts. ${STILL}`,
  },
  (SCENARIOS[scenario] ?? SCENARIOS[DEFAULT_SCENARIO]).shot(w),
];

const stateKey = (id: string) => `promo:${id}`;
async function saveState(id: string, s: State) {
  await adminDb()
    .from("integration_settings")
    .upsert(
      {
        key: stateKey(id),
        value: JSON.stringify(s),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" },
    );
}
async function loadState(id: string) {
  const { data } = await adminDb().from("integration_settings").select("value").eq("key", stateKey(id)).maybeSingle();
  return data?.value ? (JSON.parse(data.value) as State) : null;
}
const dropState = (id: string) => adminDb().from("integration_settings").delete().eq("key", stateKey(id));

async function submit(model: string, body: Record<string, unknown>, key: string) {
  const res = await fetch(`${API}/${model}`, {
    method: "POST",
    headers: { ...auth(), "Idempotency-Key": key },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as {
    request_id?: string;
    status_url?: string;
    detail?: unknown;
  };
  if (!res.ok || !json.request_id) throw new Error(`Higgsfield: ${JSON.stringify(json.detail ?? json).slice(0, 200)}`);
  return json.status_url ?? `${API}/requests/${json.request_id}/status`;
}

// Foto de partida: el recorte sin fondo (mejor referencia) o la foto principal
async function sourceImage(w: Watch) {
  const src = absolute(w.cutout) ?? w.images.map(absolute).find(Boolean);
  if (!src) throw new Error("El reloj no tiene foto");
  return src;
}

export async function startPromoVideo(watchId: string, chatId: number | null, scenario = DEFAULT_SCENARIO) {
  const db = adminDb();
  const { data } = await db.from("watches").select(WATCH_COLS).eq("id", watchId).single();
  const w = data as Watch;
  const source = await sourceImage(w);
  const { data: row, error } = await db.from("promo_videos").insert({ watch_id: w.id, chat_id: chatId, input_url: source }).select("id").single();
  if (error) throw error;
  try {
    const images = await Promise.all(
      scenes(w, scenario).map(async (sc, i) => ({
        url: await submit(
          IMAGE_MODEL,
          {
            prompt: sc.image,
            image_urls: [source],
            aspect_ratio: "9:16",
            resolution: "1k",
            quality: "medium",
          },
          `${row.id}-img${i}`,
        ),
      })),
    );
    await saveState(row.id, { stage: "images", source, images, videos: [], scenario });
    await db
      .from("promo_videos")
      .update({
        status_url: images[0].url,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
  } catch (e) {
    await db
      .from("promo_videos")
      .update({ status: "failed", error: (e as Error).message.slice(0, 1000) })
      .eq("id", row.id);
    throw e;
  }
  return row.id as string;
}

const pollToken = (id: string) =>
  createHmac("sha256", process.env.CRON_SECRET ?? "")
    .update(`promo:${id}`)
    .digest("hex")
    .slice(0, 24);
export const validPollToken = (id: string, k: string) => Boolean(process.env.CRON_SECRET) && k === pollToken(id);

// Sigue esperando en otra invocación (Higgsfield tarda varios minutos y cada función tiene un límite)
function handOff(id: string, hop: number) {
  return fetch(`${SITE}/api/promo-video/poll?id=${id}&k=${pollToken(id)}&hop=${hop}`, { signal: AbortSignal.timeout(4000) }).catch(() => {});
}

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
      const sc = scenes(wd as Watch, st.scenario);
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
      return finishPromoVideo(row, clips, st.scenario);
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
    ["-y", "-loglevel", "warning", ...files.flatMap((f) => ["-i", f]), "-loop", "1", "-framerate", "24", "-i", png, "-filter_complex", [...norm, ...chain].join(";"), "-map", "[out]", "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-movflags", "+faststart", out],
    { timeout: 180_000 },
  ).catch((e: { stderr?: string; signal?: string; message: string }) => {
    // El mensaje de execFile repite el comando entero: lo útil es lo que dice ffmpeg al final
    throw new Error(`ffmpeg: ${e.signal ? `detenido (${e.signal}) ` : ""}${(e.stderr || e.message).trim().slice(0, 900)}`);
  });
  return { final: await readFile(out), length };
}

async function finishPromoVideo(row: Row, clips: string[], scenario = DEFAULT_SCENARIO) {
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
        `🎬 <b>Video promocional</b> · ${h(w.brand)} ${h(w.model)}\n${Math.round(length)} s vertical para Reels, Stories y anuncios. Va sin sonido: ponle una canción de tendencia al subirlo a Instagram.`,
        {
          reply_markup: keyboard([[{ text: "🔁 Otra versión igual", callback_data: `mvid:${w.id}|${scenario}` }], [{ text: "🎭 Otro escenario", callback_data: `mvid:${w.id}` }]]),
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

// Botones para elegir el escenario del video de un reloj
export const scenarioButtons = (watchId: string) => [
  ...Object.entries(SCENARIOS).map(([key, sc]) => [{ text: sc.label, callback_data: `mvid:${watchId}|${key}` }]),
  [{ text: "✖️ Ahora no", callback_data: "mvid:no" }],
];
