import "server-only";
import { adminDb } from "./supabase";
import { getSettings, graph, graphAll, type SocialSettings } from "./meta";

// Sincroniza las métricas de Instagram y de la página de Facebook (a diario y con el botón
// «Actualizar» del CRM). Cada métrica se pide por separado: si Meta retira alguna, el resto sigue.
// Nombres vigentes en 2026: «views» sustituye a impressions/plays; en Facebook, page_follows y
// page_media_view sustituyen a page_fans y page_impressions (retiradas en noviembre de 2025).

const DAY = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const unix = (d: Date) => Math.floor(d.getTime() / 1000);

type Log = string[];

// Valor de una métrica de insights (total o el último punto de la serie)
async function metricValue(path: string, token: string, params: Record<string, string | number>, log: Log) {
  try {
    const r = await graph<{ data: { name: string; total_value?: { value: number }; values?: { value: number | Record<string, number> }[] }[] }>(path, token, params);
    const d = r.data?.[0];
    if (!d) return null;
    if (d.total_value) return d.total_value.value;
    const last = d.values?.[d.values.length - 1]?.value;
    return typeof last === "number" ? last : null;
  } catch (e) {
    log.push(`${params.metric}: ${(e as Error).message}`);
    return null;
  }
}

// Varias métricas en una sola llamada; si Meta rechaza alguna, se piden una a una
async function metricsFor(id: string, token: string, metrics: string[], params: Record<string, string>, log: Log) {
  const out: Record<string, number> = {};
  const read = (data: { name: string; values?: { value: unknown }[]; total_value?: { value: number } }[]) => {
    for (const d of data ?? []) {
      const v = d.total_value?.value ?? d.values?.[d.values.length - 1]?.value;
      if (typeof v === "number") out[d.name] = v;
      // Métricas por tipo (p. ej. reacciones: { like: 3, love: 1 }): se suman
      else if (v && typeof v === "object") out[d.name] = Object.values(v as Record<string, number>).reduce((a, b) => a + (Number(b) || 0), 0);
    }
  };
  try {
    read((await graph<{ data: [] }>(`${id}/insights`, token, { metric: metrics.join(","), ...params })).data);
  } catch {
    for (const metric of metrics) {
      try {
        read((await graph<{ data: [] }>(`${id}/insights`, token, { metric, ...params })).data);
      } catch (e) {
        if (log.length < 40) log.push(`${metric} (${id}): ${(e as Error).message}`);
      }
    }
  }
  return out;
}

// Ejecuta tareas de `size` en `size` (para no saturar la API)
async function inBatches<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn));
}

async function mergeDaily(platform: string, day: string, data: Record<string, unknown>) {
  const db = adminDb();
  const { data: row } = await db.from("social_daily").select("data").eq("day", day).eq("platform", platform).maybeSingle();
  const merged = { ...((row?.data as Record<string, unknown>) ?? {}), ...Object.fromEntries(Object.entries(data).filter(([, v]) => v != null)) };
  await db.from("social_daily").upsert({ day, platform, data: merged }, { onConflict: "day,platform" });
}

// ───────────────────────────── Instagram ─────────────────────────────
type IgMedia = {
  id: string; caption?: string; media_type?: string; media_product_type?: string; permalink?: string;
  thumbnail_url?: string; media_url?: string; timestamp?: string; like_count?: number; comments_count?: number;
};

const IG_POST_METRICS = ["reach", "views", "likes", "comments", "saved", "shares", "total_interactions", "profile_visits", "follows"];
const IG_REEL_METRICS = ["reach", "views", "likes", "comments", "saved", "shares", "total_interactions", "ig_reels_avg_watch_time"];

async function syncInstagram(s: SocialSettings, log: Log) {
  const token = s.page_token!;
  const ig = s.ig_id!;
  const now = new Date();
  const yesterday = new Date(now.getTime() - DAY);

  // Cuenta: seguidores al día de hoy
  const account = await graph<{ followers_count?: number; follows_count?: number; media_count?: number; username?: string }>(ig, token, {
    fields: "username,followers_count,follows_count,media_count",
  });
  await mergeDaily("instagram", isoDay(now), { followers: account.followers_count, media_count: account.media_count });

  // Métricas del día anterior (totales)
  const since = unix(new Date(isoDay(yesterday)));
  const until = unix(new Date(isoDay(now)));
  const daily: Record<string, number | null> = {};
  for (const metric of ["reach", "views", "accounts_engaged", "total_interactions", "profile_links_taps", "likes", "comments", "shares", "saves"]) {
    daily[metric] = await metricValue(`${ig}/insights`, token, { metric, period: "day", metric_type: "total_value", since, until }, log);
  }
  await mergeDaily("instagram", isoDay(yesterday), daily);

  // Serie de alcance de los últimos 30 días (para el gráfico; rellena días que falten)
  try {
    const r = await graph<{ data: { values?: { value: number; end_time: string }[] }[] }>(`${ig}/insights`, token, {
      metric: "reach", period: "day", metric_type: "time_series", since: unix(new Date(now.getTime() - 29 * DAY)), until,
    });
    for (const v of r.data?.[0]?.values ?? []) await mergeDaily("instagram", v.end_time.slice(0, 10), { reach: v.value });
  } catch (e) {
    log.push(`serie de alcance: ${(e as Error).message}`);
  }

  // Publicaciones y reels: métricas de los últimos 90 días (las antiguas apenas cambian)
  const media = await graphAll<IgMedia>(`${ig}/media`, token, {
    fields: "id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp,like_count,comments_count",
    limit: 50,
  }, 120);
  const recentCut = now.getTime() - 90 * DAY;
  await inBatches(media, 5, async (m) => {
    const isReel = m.media_product_type === "REELS";
    let metrics: Record<string, number> = { likes: m.like_count ?? 0, comments: m.comments_count ?? 0 };
    // Recientes: se actualizan cada día. Antiguas: solo la primera vez (luego apenas cambian)
    const { data: prev } = await adminDb().from("social_posts").select("metrics").eq("id", m.id).maybeSingle();
    const known = (prev?.metrics as Record<string, number> | undefined) ?? {};
    const recent = !m.timestamp || new Date(m.timestamp).getTime() >= recentCut;
    if (recent || known.reach == null) {
      metrics = { ...known, ...metrics, ...(await metricsFor(m.id, token, isReel ? IG_REEL_METRICS : IG_POST_METRICS, {}, log)) };
    } else {
      metrics = { ...known, ...metrics };
    }
    await adminDb().from("social_posts").upsert(
      {
        id: m.id, platform: "instagram", media_type: m.media_type ?? null, product_type: m.media_product_type ?? null,
        caption: m.caption ?? null, permalink: m.permalink ?? null,
        thumbnail_url: m.thumbnail_url ?? (m.media_type === "VIDEO" ? null : m.media_url ?? null),
        posted_at: m.timestamp ?? null, metrics, metrics_updated_at: now.toISOString(),
      },
      { onConflict: "id" }
    );
  });
  return { followers: account.followers_count ?? null, posts: media.length };
}

// ───────────────────────────── Facebook ─────────────────────────────
type FbPost = {
  id: string; message?: string; created_time?: string; permalink_url?: string; full_picture?: string;
  shares?: { count: number }; reactions?: { summary?: { total_count: number } }; comments?: { summary?: { total_count: number } };
};

async function syncFacebook(s: SocialSettings, log: Log) {
  const token = s.page_token!;
  const page = s.page_id!;
  const now = new Date();

  const info = await graph<{ followers_count?: number; fan_count?: number }>(page, token, { fields: "followers_count,fan_count" });
  await mergeDaily("facebook", isoDay(now), { followers: info.followers_count ?? info.fan_count });

  // Últimos 30 días, día a día
  const since = unix(new Date(now.getTime() - 30 * DAY));
  const until = unix(new Date(isoDay(now)));
  for (const metric of ["page_media_view", "page_total_media_view_unique", "page_post_engagements", "page_views_total", "page_follows"]) {
    try {
      const r = await graph<{ data: { values?: { value: number; end_time: string }[] }[] }>(`${page}/insights`, token, { metric, period: "day", since, until });
      const key = { page_media_view: "views", page_total_media_view_unique: "reach", page_post_engagements: "interactions", page_views_total: "page_views", page_follows: "follows" }[metric]!;
      for (const v of r.data?.[0]?.values ?? []) {
        if (typeof v.value === "number") await mergeDaily("facebook", v.end_time.slice(0, 10), { [key]: v.value });
      }
    } catch (e) {
      log.push(`${metric}: ${(e as Error).message}`);
    }
  }

  // Reacciones y comentarios como campos exigen el permiso pages_read_user_content: se piden aparte
  // (si no está concedido, las reacciones salen de la métrica post_reactions_by_type_total)
  const posts = await graphAll<FbPost>(`${page}/posts`, token, { fields: "id,message,created_time,permalink_url,full_picture,shares", limit: 25 }, 60);
  await inBatches(posts, 5, async (p) => {
    const raw = await metricsFor(p.id, token, ["post_media_view", "post_total_media_view_unique", "post_clicks", "post_reactions_by_type_total"], { period: "lifetime" }, log);
    try {
      const extra = await graph<FbPost>(p.id, token, { fields: "reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)" });
      p.reactions = extra.reactions;
      p.comments = extra.comments;
    } catch {
      // sin pages_read_user_content
    }
    const metrics: Record<string, number> = {
      reactions: p.reactions?.summary?.total_count ?? raw.post_reactions_by_type_total ?? 0,
      ...(p.comments?.summary && { comments: p.comments.summary.total_count }),
      shares: p.shares?.count ?? 0,
      ...(raw.post_media_view != null && { views: raw.post_media_view }),
      ...(raw.post_total_media_view_unique != null && { reach: raw.post_total_media_view_unique }),
      ...(raw.post_clicks != null && { clicks: raw.post_clicks }),
    };
    await adminDb().from("social_posts").upsert(
      {
        id: p.id, platform: "facebook", media_type: null, product_type: "FEED", caption: p.message ?? null,
        permalink: p.permalink_url ?? null, thumbnail_url: p.full_picture ?? null, posted_at: p.created_time ?? null,
        metrics, metrics_updated_at: now.toISOString(),
      },
      { onConflict: "id" }
    );
  });
  return { followers: info.followers_count ?? info.fan_count ?? null, posts: posts.length };
}

export async function syncSocial() {
  const s = await getSettings();
  if (!s.page_token || !s.page_id) return { ok: false, error: "Instagram y Facebook no están conectados." };
  const log: Log = [];
  const result: Record<string, unknown> = {};
  if (s.ig_id) {
    try {
      result.instagram = await syncInstagram(s, log);
    } catch (e) {
      log.push(`Instagram: ${(e as Error).message}`);
    }
  }
  try {
    result.facebook = await syncFacebook(s, log);
  } catch (e) {
    log.push(`Facebook: ${(e as Error).message}`);
  }
  // Los avisos de métricas que Meta no devuelve (cuentas pequeñas, métricas en desarrollo) no son errores graves
  return { ok: true, ...result, warnings: log.slice(0, 20) };
}
