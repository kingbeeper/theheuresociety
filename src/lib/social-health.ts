import "server-only";
import { adminDb } from "./supabase";
import { TIME_ZONE } from "./booking";

// Pulso de redes y qué funciona, calculado con las métricas que ya guarda la sincronización diaria.
// Sin IA: cifras exactas de la cuenta.

const DAY = 86_400_000;
type Daily = { day: string; data: Record<string, number> };
type Post = { id: string; platform: string; media_type: string | null; product_type: string | null; caption: string | null; permalink: string | null; posted_at: string | null; metrics: Record<string, number> };

const sum = (rows: Daily[], k: string) => rows.reduce((a, r) => a + (Number(r.data[k]) || 0), 0);
const pct = (now: number, base: number) => (base > 0 ? Math.round(((now - base) / base) * 100) : null);

export type Pulse = {
  status: "ok" | "warn" | "alert";
  reasons: string[];
  daysSincePost: number | null;
  week: { reach: number; views: number; interactions: number; saves_shares: number };
  base: { reach: number; views: number; interactions: number; saves_shares: number };
  change: { reach: number | null; views: number | null; interactions: number | null };
  followers: { now: number | null; delta7: number | null };
  postsLast30: number;
};

export async function socialPulse(now = Date.now()): Promise<Pulse> {
  const db = adminDb();
  const since = new Date(now - 36 * DAY).toISOString().slice(0, 10);
  const [{ data: daily }, { data: last }, { count: recent }] = await Promise.all([
    db.from("social_daily").select("day, data").eq("platform", "instagram").gte("day", since).order("day"),
    db.from("social_posts").select("posted_at").eq("platform", "instagram").order("posted_at", { ascending: false }).limit(1),
    db.from("social_posts").select("id", { count: "exact", head: true }).eq("platform", "instagram").gte("posted_at", new Date(now - 30 * DAY).toISOString()),
  ]);
  const rows = (daily ?? []) as Daily[];
  const cut7 = new Date(now - 8 * DAY).toISOString().slice(0, 10); // ayer y 6 días antes (hoy aún no tiene métricas)
  const week = rows.filter((r) => r.day > cut7);
  const prev = rows.filter((r) => r.day <= cut7);
  const weeks = Math.max(1, prev.length / 7);
  const m = (set: Daily[], div = 1) => ({
    reach: Math.round(sum(set, "reach") / div),
    views: Math.round(sum(set, "views") / div),
    interactions: Math.round(sum(set, "total_interactions") / div),
    saves_shares: Math.round((sum(set, "saves") + sum(set, "shares")) / div),
  });
  const w = m(week);
  const b = m(prev, weeks);
  const followersSeries = rows.filter((r) => r.data.followers != null);
  const fNow = followersSeries.at(-1)?.data.followers ?? null;
  const f7 = followersSeries.find((r) => r.day >= new Date(now - 7 * DAY).toISOString().slice(0, 10))?.data.followers ?? null;
  const lastPost = last?.[0]?.posted_at ? Math.floor((now - new Date(last[0].posted_at).getTime()) / DAY) : null;
  const change = { reach: pct(w.reach, b.reach), views: pct(w.views, b.views), interactions: pct(w.interactions, b.interactions) };

  const reasons: string[] = [];
  let level = 0;
  if (lastPost != null && lastPost >= 4) {
    reasons.push(`Última publicación hace ${lastPost} días (el algoritmo premia publicar de forma constante)`);
    level = Math.max(level, lastPost >= 7 ? 2 : 1);
  }
  if (change.reach != null && change.reach <= -25) {
    reasons.push(`Alcance ${change.reach}% frente a tu media semanal`);
    level = Math.max(level, change.reach <= -40 ? 2 : 1);
  }
  if (change.interactions != null && change.interactions <= -25) {
    reasons.push(`Interacciones ${change.interactions}% frente a tu media`);
    level = Math.max(level, 1);
  }
  if (b.saves_shares > 0 && w.saves_shares < b.saves_shares * 0.6) reasons.push("Menos guardados y compartidos de lo normal (lo que más mueve el alcance)");
  if (fNow != null && f7 != null && fNow - f7 <= 0) reasons.push(`Seguidores estancados esta semana (${fNow - f7 >= 0 ? "+" : ""}${fNow - f7})`);
  if ((recent ?? 0) < 8) reasons.push(`${recent ?? 0} publicaciones en 30 días (lo recomendable: 3-5 por semana)`);

  return {
    status: level === 2 ? "alert" : level === 1 || reasons.length ? "warn" : "ok",
    reasons,
    daysSincePost: lastPost,
    week: w,
    base: b,
    change,
    followers: { now: fNow, delta7: fNow != null && f7 != null ? fNow - f7 : null },
    postsLast30: recent ?? 0,
  };
}

// ───────────────────────────── Qué funciona ─────────────────────────────
const BRANDS = ["Rolex", "Patek", "Audemars", "Richard Mille", "Cartier", "Omega", "Vacheron", "Tudor", "Hublot", "Panerai"];
const WEEKDAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const FORMAT: Record<string, string> = { REELS: "Reel", CAROUSEL_ALBUM: "Carrusel", IMAGE: "Foto", VIDEO: "Video" };

type Group = { label: string; posts: number; reach: number; er: number; savesShares: number };

function groupBy(posts: Post[], key: (p: Post) => string | null) {
  const map = new Map<string, Post[]>();
  for (const p of posts) {
    const k = key(p);
    if (k) map.set(k, [...(map.get(k) ?? []), p]);
  }
  return [...map.entries()]
    .map(([label, ps]): Group => ({
      label,
      posts: ps.length,
      reach: Math.round(ps.reduce((a, p) => a + (p.metrics.reach ?? 0), 0) / ps.length),
      er: ps.reduce((a, p) => a + er(p), 0) / ps.length,
      savesShares: Math.round((ps.reduce((a, p) => a + (p.metrics.saved ?? 0) + (p.metrics.shares ?? 0), 0) / ps.length) * 10) / 10,
    }))
    .filter((g) => g.posts >= 2)
    .sort((a, b) => b.reach - a.reach);
}

// Tasa de interacción: interacciones / alcance
const er = (p: Post) => {
  const reach = p.metrics.reach ?? 0;
  const inter = p.metrics.total_interactions ?? (p.metrics.likes ?? 0) + (p.metrics.comments ?? 0) + (p.metrics.saved ?? 0) + (p.metrics.shares ?? 0);
  return reach > 0 ? inter / reach : 0;
};

const local = (iso: string) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, weekday: "short", hour: "2-digit", hour12: false }).formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return { weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday), hour: Number(parts.hour) % 24 };
};
const slot = (h: number) => (h < 12 ? "mañana (antes de 12)" : h < 17 ? "tarde (12-17)" : h < 21 ? "tarde-noche (17-21)" : "noche (21+)");

export type Insights = Awaited<ReturnType<typeof socialInsights>>;

export async function socialInsights() {
  const { data } = await adminDb().from("social_posts").select("*").eq("platform", "instagram").not("posted_at", "is", null).order("posted_at", { ascending: false }).limit(200);
  const posts = ((data ?? []) as Post[]).filter((p) => (p.metrics.reach ?? 0) > 0);
  const lang = (c: string) => (/\b(the|and|for|available|watch|dm)\b/i.test(c) ? (/\b(el|la|disponible|reloj|precio|escr)/i.test(c) ? "bilingüe" : "inglés") : /\b(el|la|disponible|reloj|precio)\b/i.test(c) ? "español" : null);
  return {
    posts: posts.length,
    avgReach: posts.length ? Math.round(posts.reduce((a, p) => a + (p.metrics.reach ?? 0), 0) / posts.length) : 0,
    avgEr: posts.length ? posts.reduce((a, p) => a + er(p), 0) / posts.length : 0,
    byFormat: groupBy(posts, (p) => FORMAT[p.product_type === "REELS" ? "REELS" : p.media_type ?? ""] ?? null),
    byWeekday: groupBy(posts, (p) => WEEKDAYS[local(p.posted_at!).weekday]),
    bySlot: groupBy(posts, (p) => slot(local(p.posted_at!).hour)),
    byBrand: groupBy(posts, (p) => BRANDS.find((b) => (p.caption ?? "").toLowerCase().includes(b.toLowerCase())) ?? null),
    byPrice: groupBy(posts, (p) => (/\$\s?\d|price|precio/i.test(p.caption ?? "") ? "con precio" : "sin precio")),
    byQuestion: groupBy(posts, (p) => ((p.caption ?? "").includes("?") ? "con pregunta" : "sin pregunta")),
    byLanguage: groupBy(posts, (p) => lang(p.caption ?? "")),
    top: [...posts]
      .sort((a, b) => (b.metrics.reach ?? 0) * (1 + er(b)) - (a.metrics.reach ?? 0) * (1 + er(a)))
      .slice(0, 5)
      .map((p) => ({ permalink: p.permalink, format: FORMAT[p.product_type === "REELS" ? "REELS" : p.media_type ?? ""] ?? "—", reach: p.metrics.reach ?? 0, er: er(p), caption: (p.caption ?? "").slice(0, 90), date: p.posted_at!.slice(0, 10) })),
  };
}

// Mejor momento para publicar: el día y la franja con más alcance medio
export function bestSlot(i: Insights) {
  return { weekday: i.byWeekday[0]?.label ?? null, slot: i.bySlot[0]?.label ?? null, format: i.byFormat[0]?.label ?? null };
}
