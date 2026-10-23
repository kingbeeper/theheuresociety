import "server-only";
import { createHmac } from "node:crypto";
import { adminDb } from "./supabase";

// Video promocional vertical (~11 s) para Reels, Stories y anuncios, al estilo de un spot de lujo:
// 1. Higgsfield Marketing Studio crea dos fotogramas con el reloj: un macro del bisel/corona en estudio
//    y el reloj sobre superficie negra bajo focos (≈ $0,01)
// 2. Kling 2.5 Turbo anima cada uno 5 s (≈ $0,21 cada uno; sin sonido: la música se pone en Instagram)
// 3. ffmpeg los une y, con los focos ya encendidos, hace aparecer el texto de la marca (gratis)
// 4. llega por Telegram. Total ≈ $0,45 por video.
// Se activa con HF_API_KEY_ID y HF_API_KEY_SECRET (API de Higgsfield).

export const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://theheuresociety.vercel.app").replace(/\/$/, "");
const API = "https://api.higgsfield.ai";
const IMAGE_MODEL = "marketing-studio/image";
export const VIDEO_MODEL = "kling-video/v2.5-turbo/standard/image-to-video";
export const W = 720;
export const H = 1280;
export const CLIP = 5; // segundos por toma
export const HOLD = 1.5; // la última imagen se queda quieta para leer el texto

export const promoConfigured = () => Boolean(process.env.HF_API_KEY_ID && process.env.HF_API_KEY_SECRET);
export const auth = () => ({
  Authorization: `Key ${process.env.HF_API_KEY_ID}:${process.env.HF_API_KEY_SECRET}`,
  "Content-Type": "application/json",
});

export type Watch = {
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
export type Row = {
  id: string;
  watch_id: string;
  chat_id: number | null;
  status: string;
};
// Estado de las peticiones a Higgsfield (en integration_settings, clave promo:<id>)
export type Job = { url: string; result?: string; failed?: boolean };
export type State = {
  stage: "images" | "videos";
  source: string;
  images: Job[];
  videos: Job[];
  opening?: string;
  scenario?: string;
};

export const priceText = (w: Watch) => (w.price == null ? "Price on request" : `${w.currency === "USD" ? "$" : `${w.currency} `}${Number(w.price).toLocaleString("en-US")}`);
const absolute = (u: string | null | undefined) => (!u ? null : u.startsWith("http") ? u : u.startsWith("/") ? `${SITE}${u}` : null);
export const WATCH_COLS = "id, slug, brand, model, reference, price, currency, images, cutout";

// El reloj de la foto tiene que salir idéntico (esfera, logotipo, agujas, brazalete)
const SAME =
  "Use the exact watch from the reference image, identical in every detail: dial color and texture, logo and dial text, hands, indices, bezel, case and strap or bracelet. Photorealistic, high-end luxury watch commercial, cinematic color grading.";
type Shot = { image: string; motion: string };
const STILL = "The watch keeps its exact shape and dial text.";

type Option = { label: string; weight: number; fit?: (t: string) => number; shot: (w: Watch) => Shot };

// Para que el modo automático elija según el reloj
const DIVER = /submariner|sea-dweller|deepsea|seamaster|planet ocean|aquanaut|fifty fathoms|pelagos|diver|yacht-master/;
const INTEGRATED = /nautilus|royal oak|aquanaut|overseas|polo|tisx|laureato|pr[ée]sident|day-date/;

// Primera toma (5 s): cómo se presenta el reloj. `weight` = prioridad en el modo automático
export const OPENINGS: Record<string, Option> = {
  esfera: {
    label: "🕐 Macro de la esfera",
    weight: 3,
    shot: (w) => ({
      image: `Extreme macro close-up of the dial of the ${w.brand} ${w.model}: indices, hands, logo and the dial texture fill the frame, crisp detail, dramatic low-key studio lighting, deep black surroundings, very shallow depth of field. ${SAME}`,
      motion: `Very slow macro camera glide across the dial, light gently sweeps over the indices and hands revealing the dial texture. Smooth, elegant, no cuts. ${STILL}`,
    }),
  },
  canto: {
    label: "⚙️ Perfil del canto",
    weight: 3,
    fit: (t) => (INTEGRATED.test(t) ? 3 : 0),
    shot: (w) => ({
      image: `Low side-profile close-up of the case of the ${w.brand} ${w.model} at eye level with the case edge: polished and brushed surfaces, crown and crystal edge, dramatic raking light on black background, very shallow depth of field. ${SAME}`,
      motion: `A slow lateral camera slide along the side of the case, a thin line of light travels across the polished and brushed finishes. Smooth, elegant, no cuts. ${STILL}`,
    }),
  },
  oscuro: {
    label: "🌑 Revelación desde la oscuridad",
    weight: 3,
    shot: (w) => ({
      image: `The ${w.brand} ${w.model} emerging from total darkness, only the contours of the case, bezel and dial edges lit by a thin raking line of light, deep black background, mysterious luxury mood. ${SAME}`,
      motion: `Starting almost completely dark, a slow line of light sweeps across the watch and gradually reveals its silhouette, case and dial. Camera nearly still. ${STILL}`,
    }),
  },
  giro: {
    label: "🌀 Giro en el aire",
    weight: 3,
    shot: (w) => ({
      image: `The ${w.brand} ${w.model} floating in mid-air at a slight angle in a dark studio, soft rim lighting outlining the case and bracelet, subtle reflections, clean black background. ${SAME}`,
      motion: `The watch slowly rotates in mid-air, turning gently to show the case from different angles, rim light glinting on the edges. Smooth, slow, elegant. ${STILL}`,
    }),
  },
  bisel: {
    label: "🔍 Macro del bisel y la corona",
    weight: 2,
    shot: (w) => ({
      image: `Extreme macro close-up of the ${w.brand} ${w.model}: the bezel, crown and edge of the case fill the frame, dramatic studio lighting with glints on polished metal, deep black background, very shallow depth of field. ${SAME}`,
      motion: `Very slow macro camera glide along the bezel and crown, a soft light sweep travels across the polished metal. Smooth, elegant, no cuts. ${STILL}`,
    }),
  },
  brazal: {
    label: "🔗 Recorrido por el brazalete",
    weight: 2,
    fit: (t) => (INTEGRATED.test(t) ? 2 : 0),
    shot: (w) => ({
      image: `Macro close-up of the bracelet links of the ${w.brand} ${w.model} leading up to the case, polished and brushed links catching warm studio light, dark background, very shallow depth of field. ${SAME}`,
      motion: `The camera glides slowly up along the bracelet links until it reaches the case and dial, light flowing over each link. Smooth, no cuts. ${STILL}`,
    }),
  },
  humo: {
    label: "💨 Entre humo",
    weight: 2,
    shot: (w) => ({
      image: `The ${w.brand} ${w.model} surrounded by soft swirling dark smoke, dramatic side lighting cutting through the haze, black background, cinematic luxury mood. ${SAME}`,
      motion: `Dark smoke slowly drifts and swirls around the watch, parting to reveal it as side light glints on the case, very slow push-in. ${STILL}`,
    }),
  },
  trasera: {
    label: "🔄 La trasera",
    weight: 1,
    shot: (w) => ({
      image: `Close-up of the caseback of the ${w.brand} ${w.model} lying face down on black stone, engraved or sapphire caseback with the movement visible if it has one, dramatic studio lighting, shallow depth of field. ${SAME}`,
      motion: `Very slow camera orbit around the caseback, light glints across the engravings and screws. Smooth and elegant. ${STILL}`,
    }),
  },
};

// Segunda toma (5 s): la escena de cierre, sobre la que aparece el texto de la marca
export const SCENARIOS: Record<string, Option> = {
  focos: {
    weight: 3,
    label: "💡 Focos de estudio",
    shot: (w) => ({
      image: `Hero product shot of the ${w.brand} ${w.model} standing upright on a glossy black reflective surface in a dark luxury studio, warm theatrical spotlights from above create pools of golden light on the watch and a soft mirror reflection below. The watch sits in the upper-middle of the frame; the lower third is empty dark space. ${SAME}`,
      motion: `In darkness, spotlights switch on one after another and illuminate the watch, light glints travel across the polished case and crystal, very slow push-in, camera steady. ${STILL}`,
    }),
  },
  terciopelo: {
    weight: 3,
    label: "🟢 Terciopelo verde y latón",
    shot: (w) => ({
      image: `The ${w.brand} ${w.model} resting on deep emerald green velvet with polished brass details, in a refined jewelry-boutique setting, soft warm directional light, rich shadows, elegant and quiet luxury. The watch sits in the upper-middle of the frame; the lower third is dark velvet. ${SAME}`,
      motion: `A soft beam of warm light slowly travels across the velvet and onto the watch, gentle slow orbit and push-in, dust particles glinting in the light. ${STILL}`,
    }),
  },
  marmol: {
    weight: 2,
    label: "🥃 Mármol, whisky y puro",
    shot: (w) => ({
      image: `Luxury still life: the ${w.brand} ${w.model} lying on a black marble table next to a crystal glass of whisky with a large ice cube, a cigar on a brass ashtray and a leather notebook, warm low-key lighting of a private members' lounge, shallow depth of field, the watch in sharp focus in the upper-middle of the frame, darker space below. ${SAME}`,
      motion: `Very slow cinematic dolly-in towards the watch, a thin ribbon of cigar smoke drifts through the warm light, ice gently shifts in the glass. ${STILL}`,
    }),
  },
  traje: {
    weight: 2,
    label: "🕴️ Traje y ciudad de noche",
    shot: (w) => ({
      image: `Close-up of a man in a tailored dark navy suit and crisp white shirt adjusting his cuff, revealing the ${w.brand} ${w.model} on his wrist, standing by a floor-to-ceiling window of a penthouse with the Miami skyline glittering at night behind, moody cinematic lighting. ${SAME}`,
      motion: `The man slowly adjusts his shirt cuff to reveal the watch, the camera gently pushes in, city lights shimmer in soft bokeh behind. ${STILL}`,
    }),
  },
  miami: {
    weight: 1,
    label: "🌴 Al volante en Miami Beach",
    shot: (w) => ({
      image: `First-person view from the driver's seat of a luxury convertible sports car cruising along Ocean Drive in Miami Beach at golden hour: a man's tanned left wrist wearing the ${w.brand} ${w.model} rests on the steering wheel, pastel Art Deco hotels, palm trees and the turquoise ocean softly out of focus behind, warm sunset light catching the watch. No visible car brand logos. ${SAME}`,
      motion: `The car cruises slowly along the beach road while the camera gently pushes in towards the watch on the wrist; palm trees and the ocean drift by in the soft-focus background, warm golden sunlight flickers on the dial. ${STILL}`,
    }),
  },
  yate: {
    weight: 1,
    fit: (t) => (/yacht-master|yachting/.test(t) ? 4 : DIVER.test(t) ? 1 : 0),
    label: "⛵ Yate al atardecer",
    shot: (w) => ({
      image: `A man's tanned wrist wearing the ${w.brand} ${w.model} resting on the polished teak and chrome railing of a luxury yacht in Biscayne Bay at sunset, the Miami skyline and calm golden water softly out of focus behind, linen shirt sleeve rolled up, warm cinematic light. ${SAME}`,
      motion: `The yacht glides gently over the water, the camera slowly pushes in to the watch on the wrist, golden reflections ripple on the water and sparkle on the case. ${STILL}`,
    }),
  },
  agua: {
    weight: 1,
    fit: (t) => (DIVER.test(t) ? 4 : 0),
    label: "💧 Agua y salpicaduras",
    shot: (w) => ({
      image: `The ${w.brand} ${w.model} in dramatic slow motion with crystal-clear water splashing around it and droplets on the crystal and case, dark background with cool rim lighting, high-speed commercial photography. The watch sits in the upper-middle of the frame. ${SAME}`,
      motion: `Super slow motion: water splashes and droplets burst around the watch and fall away, light glints on the wet case, camera steady with a slight push-in. ${STILL}`,
    }),
  },
};
export const DEFAULT_OPENING = "bisel";
export const DEFAULT_SCENARIO = "focos";

export const scenes = (w: Watch, opening = DEFAULT_OPENING, scenario = DEFAULT_SCENARIO): Shot[] => [
  (OPENINGS[opening] ?? OPENINGS[DEFAULT_OPENING]).shot(w),
  (SCENARIOS[scenario] ?? SCENARIOS[DEFAULT_SCENARIO]).shot(w),
];

// Modo automático: sorteo según la prioridad de cada toma y lo que encaja con el reloj, sin repetir las 2 últimas
const RECENT = "promo_recent";
async function pickAuto(w: Watch, opening: string, scenario: string) {
  const db = adminDb();
  const { data } = await db.from("integration_settings").select("value").eq("key", RECENT).maybeSingle();
  const recent = (data?.value ? JSON.parse(data.value) : { open: [], close: [] }) as { open: string[]; close: string[] };
  const t = `${w.brand} ${w.model}`.toLowerCase();
  const draw = (all: Record<string, Option>, avoid: string[]) => {
    const pool = Object.entries(all).filter(([k]) => !avoid.includes(k));
    const total = pool.reduce((n, [, o]) => n + o.weight + (o.fit?.(t) ?? 0), 0);
    let r = Math.random() * total;
    for (const [k, o] of pool) if ((r -= o.weight + (o.fit?.(t) ?? 0)) <= 0) return k;
    return pool[0][0];
  };
  const open = OPENINGS[opening] ? opening : draw(OPENINGS, recent.open);
  const close = SCENARIOS[scenario] ? scenario : draw(SCENARIOS, recent.close);
  await db.from("integration_settings").upsert(
    { key: RECENT, value: JSON.stringify({ open: [open, ...recent.open].slice(0, 2), close: [close, ...recent.close].slice(0, 2) }), updated_at: new Date().toISOString() },
    { onConflict: "key" },
  );
  return { open, close };
}

const stateKey = (id: string) => `promo:${id}`;
export async function saveState(id: string, s: State) {
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
export async function loadState(id: string) {
  const { data } = await adminDb().from("integration_settings").select("value").eq("key", stateKey(id)).maybeSingle();
  return data?.value ? (JSON.parse(data.value) as State) : null;
}
export const dropState = (id: string) => adminDb().from("integration_settings").delete().eq("key", stateKey(id));

export async function submit(model: string, body: Record<string, unknown>, key: string) {
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

export async function startPromoVideo(watchId: string, chatId: number | null, opening = "auto", scenario = "auto") {
  const db = adminDb();
  const { data } = await db.from("watches").select(WATCH_COLS).eq("id", watchId).single();
  const w = data as Watch;
  const source = await sourceImage(w);
  const { open, close } = await pickAuto(w, opening, scenario);
  const { data: row, error } = await db.from("promo_videos").insert({ watch_id: w.id, chat_id: chatId, input_url: source }).select("id").single();
  if (error) throw error;
  try {
    const images = await Promise.all(
      scenes(w, open, close).map(async (sc, i) => ({
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
    await saveState(row.id, { stage: "images", source, images, videos: [], opening: open, scenario: close });
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
export function handOff(id: string, hop: number) {
  return fetch(`${SITE}/api/promo-video/poll?id=${id}&k=${pollToken(id)}&hop=${hop}`, { signal: AbortSignal.timeout(4000) }).catch(() => {});
}

// Botones de Telegram: primero la apertura, luego el cierre (callback mvid:<reloj>|<apertura>|<cierre>)
const byPriority = (all: Record<string, Option>) => Object.entries(all).sort(([, a], [, b]) => b.weight - a.weight);
export const label = (key: string) => (OPENINGS[key] ?? SCENARIOS[key])?.label ?? "🎲 Automático";
export const openingButtons = (watchId: string) => [
  [{ text: "🎲 Automático (según prioridad)", callback_data: `mvid:${watchId}|auto|auto` }],
  ...byPriority(OPENINGS).map(([key, o]) => [{ text: o.label, callback_data: `mvid:${watchId}|${key}` }]),
  [{ text: "✖️ Ahora no", callback_data: "mvid:no" }],
];
export const closingButtons = (watchId: string, opening: string) => [
  [{ text: "🎲 Automático (según prioridad)", callback_data: `mvid:${watchId}|${opening}|auto` }],
  ...byPriority(SCENARIOS).map(([key, o]) => [{ text: o.label, callback_data: `mvid:${watchId}|${opening}|${key}` }]),
  [{ text: "✖️ Ahora no", callback_data: "mvid:no" }],
];
