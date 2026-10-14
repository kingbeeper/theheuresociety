import "server-only";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { adminDb, PHOTO_BUCKET } from "./supabase";
import { getSettings, graph } from "./meta";
import type { Idea } from "./social-growth";
import { escapeHtml as h, notifyAdmins } from "./telegram";

// Publicación en Instagram (API de contenido): las ideas aprobadas se publican solas a su hora,
// o al momento con «Publicar ahora». Reel → el video promocional del reloj; foto, carrusel o
// historia → las fotos del reloj. Necesita el permiso instagram_content_publish.
// Instagram procesa el video unos minutos: el contenedor se guarda y se publica en la siguiente pasada.

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://theheuresociety.vercel.app").replace(/\/$/, "");
const absolute = (u: string) => (u.startsWith("http") ? u : `${SITE}${u.startsWith("/") ? "" : "/"}${u}`);

type PublishIdea = Idea & { ig_container_id?: string | null; publish_error?: string | null; auto_publish?: boolean };

// Instagram solo acepta JPEG: las demás fotos se convierten y se suben al almacenamiento público
async function jpegUrl(url: string) {
  const abs = absolute(url);
  if (/\.jpe?g(\?|$)/i.test(abs)) return abs;
  const bytes = Buffer.from(await (await fetch(abs)).arrayBuffer());
  const jpg = await sharp(bytes).rotate().jpeg({ quality: 90 }).toBuffer();
  const path = `promo/ig/${createHash("sha1").update(abs).digest("hex").slice(0, 16)}.jpg`;
  const bucket = adminDb().storage.from(PHOTO_BUCKET);
  await bucket.upload(path, jpg, { contentType: "image/jpeg", upsert: true });
  return bucket.getPublicUrl(path).data.publicUrl;
}

export function captionFor(i: Pick<Idea, "caption_es" | "caption_en" | "hashtags">) {
  return [i.caption_es, i.caption_en, i.hashtags.join(" ")].filter(Boolean).join("\n\n").slice(0, 2200);
}

// Lo que se publicaría: el video (reel) o las fotos (foto, carrusel, historia). null si falta.
export async function mediaFor(i: Pick<Idea, "format" | "watch_id">) {
  if (!i.watch_id) return null;
  const db = adminDb();
  if (i.format === "reel") {
    const { data } = await db.from("promo_videos").select("final_url").eq("watch_id", i.watch_id).eq("status", "done").order("created_at", { ascending: false }).limit(1).maybeSingle();
    return data?.final_url ? { video: data.final_url as string } : null;
  }
  const { data: w } = await db.from("watches").select("images").eq("id", i.watch_id).maybeSingle();
  const images = ((w?.images ?? []) as string[]).filter(Boolean);
  if (!images.length) return null;
  return { images: i.format === "carousel" ? images.slice(0, 10) : images.slice(0, 1) };
}

// Crea el contenedor en Instagram (aún no se publica)
async function createContainer(i: PublishIdea, igId: string, token: string) {
  const media = await mediaFor(i);
  if (!media) throw new Error(i.format === "reel" ? "Falta el video promocional del reloj" : "El reloj no tiene fotos");
  const caption = i.format === "story" ? undefined : captionFor(i);
  if ("video" in media) {
    const r = await graph<{ id: string }>(`${igId}/media`, token, {}, { method: "POST", body: { media_type: "REELS", video_url: media.video, caption, share_to_feed: true } });
    return r.id;
  }
  const urls = await Promise.all(media.images.map(jpegUrl));
  if (i.format === "story") {
    return (await graph<{ id: string }>(`${igId}/media`, token, {}, { method: "POST", body: { media_type: "STORIES", image_url: urls[0] } })).id;
  }
  if (urls.length > 1) {
    const children = [];
    for (const image_url of urls) children.push((await graph<{ id: string }>(`${igId}/media`, token, {}, { method: "POST", body: { image_url, is_carousel_item: true } })).id);
    return (await graph<{ id: string }>(`${igId}/media`, token, {}, { method: "POST", body: { media_type: "CAROUSEL", children: children.join(","), caption } })).id;
  }
  return (await graph<{ id: string }>(`${igId}/media`, token, {}, { method: "POST", body: { image_url: urls[0], caption } })).id;
}

// Avanza una idea: crea el contenedor, espera a que Instagram lo procese y lo publica.
// Devuelve "published", "processing" (se reintenta en la siguiente pasada) o lanza el error.
export async function advancePublish(i: PublishIdea, waitMs = 60_000): Promise<{ state: "published"; permalink: string | null } | { state: "processing" }> {
  const s = await getSettings();
  if (!s.ig_id || !s.page_token) throw new Error("Instagram no está conectado");
  const db = adminDb();
  let container = i.ig_container_id ?? null;
  if (!container) {
    container = await createContainer(i, s.ig_id, s.page_token);
    await db.from("content_ideas").update({ ig_container_id: container }).eq("id", i.id);
  }
  // Los videos tardan en procesarse; las fotos suelen estar listas al momento
  const deadline = Date.now() + waitMs;
  for (;;) {
    const st = await graph<{ status_code?: string; status?: string }>(container, s.page_token, { fields: "status_code,status" });
    if (st.status_code === "FINISHED") break;
    if (st.status_code === "ERROR" || st.status_code === "EXPIRED") {
      await db.from("content_ideas").update({ ig_container_id: null }).eq("id", i.id);
      throw new Error(`Instagram no pudo procesar el archivo (${st.status ?? st.status_code})`);
    }
    if (Date.now() > deadline) return { state: "processing" };
    await new Promise((r) => setTimeout(r, 5_000));
  }
  const pub = await graph<{ id: string }>(`${s.ig_id}/media_publish`, s.page_token, {}, { method: "POST", body: { creation_id: container } });
  const info = await graph<{ permalink?: string }>(pub.id, s.page_token, { fields: "permalink" }).catch(() => ({ permalink: undefined }));
  const permalink = info.permalink ?? null;
  await db
    .from("content_ideas")
    .update({ status: "posted", published_at: new Date().toISOString(), ig_media_id: pub.id, permalink, ig_container_id: null, publish_error: null })
    .eq("id", i.id);
  await notifyAdmins(`✅ <b>Publicado en Instagram</b> · ${h(i.title)}${permalink ? `\n${permalink}` : ""}`).catch(() => {});
  return { state: "published", permalink };
}

// Pasada periódica: ideas aprobadas cuya hora ya llegó (o con un video procesándose)
export async function publishDue(now = Date.now()) {
  const db = adminDb();
  const { data } = await db
    .from("content_ideas")
    .select("*")
    .eq("status", "approved")
    .eq("auto_publish", true)
    .is("published_at", null)
    .is("publish_error", null)
    .lte("scheduled_for", new Date(now).toISOString())
    .order("scheduled_for")
    .limit(5);
  const out: { id: string; result: string }[] = [];
  for (const i of (data ?? []) as PublishIdea[]) {
    try {
      const r = await advancePublish(i, 45_000);
      out.push({ id: i.id, result: r.state });
    } catch (e) {
      const msg = (e as Error).message.slice(0, 300);
      await db.from("content_ideas").update({ publish_error: msg }).eq("id", i.id);
      await notifyAdmins(`⚠️ <b>No se pudo publicar</b> · ${h(i.title)}\n${h(msg)}\nRevísalo en Redes → Engagement (puedes reintentarlo o publicarlo a mano).`).catch(() => {});
      out.push({ id: i.id, result: `error: ${msg}` });
    }
  }
  return out;
}
