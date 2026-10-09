import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { adminDb } from "./supabase";
import { getSettings, graph, type SocialSettings } from "./meta";
import { socialInsights, socialPulse, bestSlot } from "./social-health";
import { miamiToUtc, todayInMiami } from "./booking";

// Engagement en redes: comentarios (y respuestas sugeridas), competencia y plan de contenido.

const client = new Anthropic();
const DAY = 86_400_000;

// ───────────────────────────── Comentarios ─────────────────────────────
type IgComment = { id: string; text?: string; username?: string; timestamp?: string; replies?: { data: { username?: string }[] } };

// Trae los comentarios de las publicaciones recientes de Instagram (el webhook solo ve los nuevos)
export async function syncComments(s: SocialSettings, posts = 25) {
  const db = adminDb();
  const { data: recent } = await db.from("social_posts").select("id, permalink").eq("platform", "instagram").order("posted_at", { ascending: false }).limit(posts);
  let added = 0;
  for (const p of recent ?? []) {
    let list: IgComment[] = [];
    try {
      list = (await graph<{ data: IgComment[] }>(`${p.id}/comments`, s.page_token!, { fields: "id,text,username,timestamp,replies{username}", limit: 50 })).data ?? [];
    } catch {
      continue;
    }
    for (const c of list) {
      if (!c.text || c.username === s.ig_username) continue;
      const answered = (c.replies?.data ?? []).some((r) => r.username === s.ig_username);
      const { data } = await db
        .from("social_comments")
        .upsert(
          { id: c.id, platform: "instagram", post_id: p.id, from_username: c.username ?? null, text: c.text, permalink: p.permalink, created_at: c.timestamp ?? new Date().toISOString() },
          { onConflict: "id", ignoreDuplicates: true }
        )
        .select("id");
      if (data?.length) added++;
      if (answered) await db.from("social_comments").update({ replied_at: new Date().toISOString() }).eq("id", c.id).is("replied_at", null);
    }
  }
  return added;
}

export async function unansweredComments(limit = 30) {
  const { data } = await adminDb()
    .from("social_comments")
    .select("id, platform, post_id, from_username, text, permalink, created_at, suggested_reply, is_lead")
    .is("replied_at", null)
    .gte("created_at", new Date(Date.now() - 60 * DAY).toISOString())
    .order("created_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}

const RepliesSchema = z.object({ replies: z.array(z.object({ id: z.string(), reply: z.string() })) });

// Respuesta sugerida para cada comentario sin responder (mismo idioma, tono cercano y elegante)
export async function suggestReplies() {
  const pending = (await unansweredComments(20)).filter((c) => !c.suggested_reply);
  if (!pending.length) return 0;
  const db = adminDb();
  const { data: posts } = await db.from("social_posts").select("id, caption").in("id", pending.map((c) => c.post_id).filter(Boolean) as string[]);
  const caption = new Map((posts ?? []).map((p) => [p.id as string, ((p.caption as string) ?? "").slice(0, 200)]));
  const res = await client.beta.messages.parse({
    model: "claude-opus-5-5",
    max_tokens: 6000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: betaZodOutputFormat(RepliesSchema) },
    system: `Escribes las respuestas públicas a comentarios de Instagram de The Heure Society, un dealer de relojes de lujo en Miami. Respuestas cortas (1-2 frases), cálidas y elegantes, en el idioma del comentario, que inviten a seguir la conversación: agradecer, una pregunta abierta o invitar a escribir por DM. Nunca des precios en público: invita a escribir por mensaje privado. Sin hashtags; un emoji como mucho.`,
    messages: [{ role: "user", content: JSON.stringify(pending.map((c) => ({ id: c.id, from: c.from_username, comment: c.text, post: caption.get(c.post_id as string) ?? "" }))) }],
  });
  for (const r of res.parsed_output?.replies ?? []) await db.from("social_comments").update({ suggested_reply: r.reply }).eq("id", r.id);
  return res.parsed_output?.replies.length ?? 0;
}

// Responder en público desde la cuenta (Instagram)
export async function replyComment(id: string, text: string) {
  const s = await getSettings();
  await graph(`${id}/replies`, s.page_token!, { message: text }, { method: "POST" });
  await adminDb().from("social_comments").update({ replied_at: new Date().toISOString(), reply_text: text }).eq("id", id);
}

// ───────────────────────────── Competencia ─────────────────────────────
type BdMedia = { like_count?: number; comments_count?: number; timestamp: string; media_type?: string; media_product_type?: string; permalink?: string };
export const competitorList = (s: SocialSettings) => (s.competitors ?? "").split(/[\s,]+/).map((u) => u.replace(/^@/, "").trim().toLowerCase()).filter(Boolean).slice(0, 6);

export async function snapshotCompetitors(s: SocialSettings) {
  const db = adminDb();
  const today = todayInMiami();
  for (const u of competitorList(s)) {
    try {
      const r = await graph<{ business_discovery: { followers_count: number; media_count: number; media?: { data: BdMedia[] } } }>(s.ig_id!, s.page_token!, {
        fields: `business_discovery.username(${u}){followers_count,media_count,media.limit(20){like_count,comments_count,timestamp,media_type,media_product_type,permalink}}`,
      });
      const bd = r.business_discovery;
      await db.from("social_competitors").upsert({ username: u, day: today, data: { followers: bd.followers_count, media_count: bd.media_count, posts: bd.media?.data ?? [] } }, { onConflict: "username,day" });
    } catch (e) {
      await db.from("social_competitors").upsert({ username: u, day: today, data: { error: (e as Error).message.slice(0, 200) } }, { onConflict: "username,day" });
    }
  }
}

export type CompetitorRow = { username: string; followers: number | null; delta7: number | null; postsPerWeek: number | null; avgInteractions: number | null; er: number | null; reelsShare: number | null; best: BdMedia | null; error?: string; mine?: boolean };

const summarizePosts = (posts: BdMedia[], followers: number | null, now: number) => {
  const recent = posts.filter((p) => new Date(p.timestamp).getTime() >= now - 28 * DAY);
  const inter = (p: BdMedia) => (p.like_count ?? 0) + (p.comments_count ?? 0);
  const avg = posts.length ? posts.reduce((a, p) => a + inter(p), 0) / posts.length : null;
  return {
    postsPerWeek: Math.round((recent.length / 4) * 10) / 10,
    avgInteractions: avg == null ? null : Math.round(avg),
    er: avg != null && followers ? avg / followers : null,
    reelsShare: posts.length ? posts.filter((p) => p.media_product_type === "REELS").length / posts.length : null,
    best: [...posts].sort((a, b) => inter(b) - inter(a))[0] ?? null,
  };
};

// Tabla comparativa: la cuenta propia (mismas medidas públicas: «me gusta» + comentarios) y la competencia
export async function competitorBoard(now = Date.now()): Promise<CompetitorRow[]> {
  const s = await getSettings();
  const db = adminDb();
  const rows: CompetitorRow[] = [];
  const { data: own } = await db.from("social_posts").select("posted_at, media_type, product_type, permalink, metrics").eq("platform", "instagram").order("posted_at", { ascending: false }).limit(20);
  const { data: ownF } = await db.from("social_daily").select("day, data").eq("platform", "instagram").order("day", { ascending: false }).limit(10);
  const followers = (ownF ?? []).map((r) => (r.data as Record<string, number>).followers).find((v) => v != null) ?? null;
  const ownPosts: BdMedia[] = (own ?? []).map((p) => ({ timestamp: p.posted_at as string, like_count: (p.metrics as Record<string, number>).likes, comments_count: (p.metrics as Record<string, number>).comments, media_product_type: p.product_type as string, permalink: p.permalink as string }));
  rows.push({ username: s.ig_username ?? "tú", followers, delta7: null, ...summarizePosts(ownPosts, followers, now), mine: true });
  for (const u of competitorList(s)) {
    const { data } = await db.from("social_competitors").select("day, data").eq("username", u).order("day", { ascending: false }).limit(8);
    const latest = data?.[0]?.data as { followers?: number; posts?: BdMedia[]; error?: string } | undefined;
    if (!latest || latest.error) {
      rows.push({ username: u, followers: null, delta7: null, postsPerWeek: null, avgInteractions: null, er: null, reelsShare: null, best: null, error: latest?.error ?? "Aún sin datos (se toman en la sincronización diaria)" });
      continue;
    }
    const old = (data ?? []).at(-1)?.data as { followers?: number } | undefined;
    rows.push({ username: u, followers: latest.followers ?? null, delta7: latest.followers != null && old?.followers != null && data!.length > 1 ? latest.followers - old.followers : null, ...summarizePosts(latest.posts ?? [], latest.followers ?? null, now) });
  }
  return rows;
}

// ───────────────────────────── Plan de contenido ─────────────────────────────
const IdeasSchema = z.object({
  ideas: z.array(
    z.object({
      format: z.enum(["reel", "carousel", "post", "story"]),
      title: z.string().describe("Título corto de la idea"),
      why: z.string().describe("Por qué funcionará, citando los datos de la cuenta"),
      watch_id: z.string().nullable().describe("id de un reloj de la lista si la idea es de un reloj concreto; si no, null"),
      caption_es: z.string(),
      caption_en: z.string(),
      hashtags: z.array(z.string()).describe("8-15 hashtags sin espacios, con #"),
      visual_brief: z.string().describe("Qué grabar o qué fotos usar, en 1-2 frases"),
      day_offset: z.number().int().describe("Días desde hoy (0 = hoy) en que conviene publicarla"),
      time: z.string().describe("Hora de Miami HH:MM"),
    })
  ),
});

export async function generateContentPlan(user: string, count = 5) {
  const db = adminDb();
  const [pulse, insights, { data: watches }, { data: recentPosts }, competitors] = await Promise.all([
    socialPulse(),
    socialInsights(),
    db.from("watches").select("id, brand, model, reference, price, currency, status, published_at").in("status", ["available", "reserved"]).order("published_at", { ascending: false }).limit(30),
    db.from("social_posts").select("caption, product_type, posted_at").eq("platform", "instagram").order("posted_at", { ascending: false }).limit(10),
    competitorBoard().catch(() => []),
  ]);
  const { demandBoard } = await import("./demand");
  const demand = (await demandBoard().catch(() => [])).filter((r) => r.people.length).slice(0, 6).map((r) => ({ model: r.family, clients: r.people.length, inStock: r.stock.length }));
  const { data: drops } = await db.from("inventory_events").select("body, created_at").eq("type", "price").gte("created_at", new Date(Date.now() - 14 * DAY).toISOString()).limit(10);
  const best = bestSlot(insights);

  const res = await client.beta.messages.parse({
    model: "claude-opus-5-5",
    max_tokens: 12000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(IdeasSchema) },
    system: `Eres el estratega de redes de The Heure Society, un dealer de relojes de lujo de segunda mano en Miami (Instagram @theheuresociety). Propones publicaciones concretas para recuperar alcance e interacción, con piezas reales del inventario. Basa cada idea en los datos que te paso (formatos, días y franjas que mejor funcionan, lo que buscan los clientes, lo que funciona a la competencia). Mezcla tipos: reels de piezas, carruseles que provoquen comentarios (comparativas, «¿cuál elegirías?»), datos de mercado que se guarden y compartan, stories con encuestas, novedades y bajadas de precio. Textos naturales y elegantes, sin exagerar; en el texto en inglés y en español invita a escribir por DM. No inventes precios ni datos: usa solo los de la lista.`,
    messages: [
      {
        role: "user",
        content: JSON.stringify({
          hoy_miami: todayInMiami(),
          ideas_a_proponer: count,
          pulso: { estado: pulse.status, motivos: pulse.reasons, dias_sin_publicar: pulse.daysSincePost },
          que_funciona: {
            mejor_dia: best.weekday, mejor_franja: best.slot, mejor_formato: best.format,
            formatos: insights.byFormat, dias: insights.byWeekday.slice(0, 4), marcas: insights.byBrand, con_pregunta: insights.byQuestion, idioma: insights.byLanguage,
            mejores_posts: insights.top,
          },
          inventario_publicado: (watches ?? []).map((w) => ({ id: w.id, reloj: `${w.brand} ${w.model} ${w.reference}`, precio: w.price ?? "a consultar", estado: w.status, publicado: (w.published_at as string)?.slice(0, 10) })),
          lo_que_buscan_clientes: demand,
          bajadas_de_precio_recientes: (drops ?? []).map((d) => d.body),
          ultimas_publicaciones: (recentPosts ?? []).map((p) => ({ fecha: (p.posted_at as string)?.slice(0, 10), tipo: p.product_type, texto: ((p.caption as string) ?? "").slice(0, 120) })),
          competencia: competitors.filter((c) => !c.mine && !c.error).map((c) => ({ cuenta: c.username, seguidores: c.followers, posts_semana: c.postsPerWeek, interaccion_media: c.avgInteractions, porcentaje_reels: c.reelsShare })),
        }),
      },
    ],
  });
  const ideas = res.parsed_output?.ideas ?? [];
  const validIds = new Set((watches ?? []).map((w) => w.id as string));
  const rows = ideas.map((i) => {
    const day = new Date(miamiToUtc(todayInMiami(), "12:00").getTime() + Math.max(0, Math.min(13, i.day_offset)) * DAY).toISOString().slice(0, 10);
    const time = /^\d{2}:\d{2}$/.test(i.time) ? i.time : "18:00";
    return {
      format: i.format, title: i.title, why: i.why, watch_id: i.watch_id && validIds.has(i.watch_id) ? i.watch_id : null,
      caption_es: i.caption_es, caption_en: i.caption_en, hashtags: i.hashtags.slice(0, 20), visual_brief: i.visual_brief,
      // Nunca en el pasado: si esa hora ya pasó (o falta menos de 1 h), al día siguiente
      scheduled_for: new Date(miamiToUtc(day, time).getTime() + (miamiToUtc(day, time).getTime() < Date.now() + 3_600_000 ? DAY : 0)).toISOString(),
      created_by: user,
    };
  });
  if (!rows.length) return [];
  const { data, error } = await db.from("content_ideas").insert(rows).select("*");
  if (error) throw error;
  return data ?? [];
}

export type Idea = { id: string; status: string; format: string; title: string; why: string | null; watch_id: string | null; caption_es: string | null; caption_en: string | null; hashtags: string[]; visual_brief: string | null; scheduled_for: string | null };
