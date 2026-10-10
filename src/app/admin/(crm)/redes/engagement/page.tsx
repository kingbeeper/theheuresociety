import Link from "next/link";
import { connection } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { adminDb } from "@/lib/supabase";
import { getSettings } from "@/lib/meta";
import { socialInsights, socialPulse } from "@/lib/social-health";
import { competitorBoard, unansweredComments, type Idea } from "@/lib/social-growth";
import { TIME_ZONE } from "@/lib/booking";
import { OPENINGS, SCENARIOS, promoConfigured } from "@/lib/promo-video";
import { buttonClass, Card, fieldClass, ghostButtonClass, PageTitle } from "@/components/admin/ui";
import { generateIdeasAction, ideaStatusAction, ideaVideoAction, ignoreCommentAction, replyCommentAction, saveEngagementSettings, suggestRepliesAction } from "../../../social-actions";

export const metadata = { title: "Engagement" };

const n = (v: number | null | undefined) => (v == null ? "—" : Math.round(v).toLocaleString("es-ES"));
const pctTxt = (v: number | null) => (v == null ? "—" : v > 300 ? `×${Math.round(v / 100 + 1)}` : `${v > 0 ? "+" : ""}${v}%`);
const when = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("es-ES", { timeZone: TIME_ZONE, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : "—";
const FORMAT: Record<string, string> = { reel: "🎬 Reel", carousel: "🖼 Carrusel", post: "📷 Foto", story: "⭕ Story" };

type PreviewWatch = { id: string; brand: string; model: string; reference: string; images: string[]; cutout: string | null };
type PreviewVideo = { status: string; final_url: string | null; created_at: string };

// Cómo se verá en Instagram: el reel (o la foto) en vertical con el texto debajo, y el botón para generar el video
function IdeaPreview({ idea, watch, video, canVideo }: { idea: Idea; watch?: PreviewWatch; video?: PreviewVideo; canVideo: boolean }) {
  const photo = watch?.images?.[0] ?? watch?.cutout ?? null;
  const pending = video && (video.status === "queued" || video.status === "rendering");
  const ready = video?.status === "done" && video.final_url;
  const caption = [idea.caption_es, idea.hashtags.join(" ")].filter(Boolean).join("\n\n");
  return (
    <div className="mt-3 grid gap-4 sm:grid-cols-[180px_1fr]">
      <div className="relative mx-auto aspect-[9/16] w-[180px] overflow-hidden rounded-xl border border-line bg-black">
        {ready ? (
          <video src={video.final_url!} controls playsInline muted loop preload="metadata" poster={photo ?? undefined} className="h-full w-full object-cover" />
        ) : photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo} alt={`${watch?.brand} ${watch?.model}`} className={`h-full w-full object-cover ${idea.format === "reel" ? "opacity-60" : ""}`} />
        ) : (
          <div className="flex h-full items-center justify-center p-4 text-center text-xs text-stone">Sin reloj asociado</div>
        )}
        {!ready && idea.format === "reel" && watch && (
          <p className="absolute inset-x-0 bottom-0 bg-black/70 p-2 text-center text-[0.6rem] tracking-[0.12em] uppercase">{pending ? "⏳ Generando el video… (3-4 min)" : video?.status === "failed" ? "⚠️ Falló el video" : "Aún sin video"}</p>
        )}
      </div>
      <div className="min-w-0 text-xs">
        <p className="font-semibold">theheuresociety</p>
        <p className="mt-1 line-clamp-6 whitespace-pre-wrap text-stone">{caption || "—"}</p>
        {watch && canVideo && !pending && (
          <form action={ideaVideoAction.bind(null, watch.id)} className="mt-3 grid gap-2">
            <select name="opening" defaultValue="auto" className={fieldClass} aria-label="Apertura">
              <option value="auto">🎲 Apertura automática</option>
              {Object.entries(OPENINGS).map(([k, o]) => <option key={k} value={k}>{o.label}</option>)}
            </select>
            <select name="closing" defaultValue="auto" className={fieldClass} aria-label="Cierre">
              <option value="auto">🎲 Cierre automático</option>
              {Object.entries(SCENARIOS).map(([k, o]) => <option key={k} value={k}>{o.label}</option>)}
            </select>
            <button className={ghostButtonClass}>🎬 {ready ? "Otra versión del video" : "Generar video"} · ≈ $0,45</button>
          </form>
        )}
        {pending && <Link href="/admin/redes/engagement" className="mt-3 inline-block text-[0.62rem] tracking-[0.16em] uppercase text-brass hover:text-ivory">↻ Actualizar</Link>}
        {ready && <a href={video.final_url!} download className="mt-2 inline-block text-[0.62rem] tracking-[0.16em] uppercase text-stone hover:text-ivory">⬇ Descargar video</a>}
      </div>
    </div>
  );
}

export default async function EngagementPage() {
  await connection();
  await requireAdmin("redes");
  const [s, pulse, insights, comments, board, { data: ideaRows }] = await Promise.all([
    getSettings(),
    socialPulse(),
    socialInsights(),
    unansweredComments(),
    competitorBoard(),
    adminDb().from("content_ideas").select("*").in("status", ["suggested", "approved"]).order("scheduled_for"),
  ]);
  const ideas = (ideaRows ?? []) as Idea[];
  // Vista previa: foto del reloj y su último video promocional
  const watchIds = [...new Set(ideas.map((i) => i.watch_id).filter(Boolean))] as string[];
  const [{ data: watchRows }, { data: videoRows }] = watchIds.length
    ? await Promise.all([
        adminDb().from("watches").select("id, brand, model, reference, images, cutout").in("id", watchIds),
        adminDb().from("promo_videos").select("watch_id, status, final_url, created_at").in("watch_id", watchIds).order("created_at", { ascending: false }),
      ])
    : [{ data: [] }, { data: [] }];
  const watches = new Map((watchRows ?? []).map((w) => [w.id as string, w as PreviewWatch]));
  const videos = new Map<string, PreviewVideo>();
  for (const v of (videoRows ?? []) as (PreviewVideo & { watch_id: string })[]) {
    if (videos.has(v.watch_id)) continue;
    // Un intento fallido no tapa un video anterior que sí está bien
    if (v.status === "failed" && (videoRows ?? []).some((o) => o.watch_id === v.watch_id && o.status === "done")) continue;
    videos.set(v.watch_id, v);
  }
  const canVideo = promoConfigured();
  const tone = { ok: "border-emerald-300/40 bg-emerald-300/5", warn: "border-amber-300/40 bg-amber-300/5", alert: "border-red-300/40 bg-red-300/5" }[pulse.status];
  const groups: [string, typeof insights.byFormat][] = [
    ["Formato", insights.byFormat], ["Día", insights.byWeekday.slice(0, 4)], ["Franja horaria", insights.bySlot], ["Marca", insights.byBrand],
    ["Pregunta en el texto", insights.byQuestion], ["Idioma", insights.byLanguage],
  ];

  return (
    <>
      <Link href="/admin/redes" className="text-[0.66rem] tracking-[0.2em] uppercase text-stone hover:text-ivory">← Redes</Link>
      <PageTitle eyebrow="Redes" title="Engagement" />

      {/* 1 · Pulso */}
      <div className={`border p-5 ${tone}`}>
        <p className="font-display text-2xl">{pulse.status === "ok" ? "✅ Las redes van bien" : pulse.status === "warn" ? "📉 Las redes están flojas" : "🚨 Las redes están paradas"}</p>
        {pulse.reasons.length > 0 && <ul className="mt-2 space-y-1 text-sm">{pulse.reasons.map((r) => <li key={r}>• {r}</li>)}</ul>}
        <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <p><span className="block text-[0.6rem] tracking-[0.16em] uppercase text-stone">Alcance 7 días</span>{n(pulse.week.reach)} <span className="text-xs text-stone">({pctTxt(pulse.change.reach)})</span></p>
          <p><span className="block text-[0.6rem] tracking-[0.16em] uppercase text-stone">Interacciones 7 días</span>{n(pulse.week.interactions)} <span className="text-xs text-stone">({pctTxt(pulse.change.interactions)})</span></p>
          <p><span className="block text-[0.6rem] tracking-[0.16em] uppercase text-stone">Seguidores</span>{n(pulse.followers.now)} <span className="text-xs text-stone">({pulse.followers.delta7 == null ? "—" : `${pulse.followers.delta7 >= 0 ? "+" : ""}${pulse.followers.delta7} en 7 d`})</span></p>
          <p><span className="block text-[0.6rem] tracking-[0.16em] uppercase text-stone">Publicaciones 30 días</span>{pulse.postsLast30}{pulse.daysSincePost != null && <span className="text-xs text-stone"> · última hace {pulse.daysSincePost} d</span>}</p>
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        {/* 3 · Ideas y calendario */}
        <Card title={`Ideas y calendario · ${ideas.length}`} className="xl:col-span-2">
          <form action={generateIdeasAction} className="mb-4">
            <button className={buttonClass}>💡 Generar ideas nuevas</button>
            <span className="ml-3 text-xs text-stone">Con tu inventario, lo que buscan los clientes y lo que mejor te funciona. Tarda ~1 minuto.</span>
          </form>
          {ideas.length ? (
            <ul className="grid gap-4 lg:grid-cols-2">
              {ideas.map((i) => (
                <li key={i.id} className={`border p-4 text-sm ${i.status === "approved" ? "border-emerald-300/40" : "border-line"}`}>
                  <p className="text-[0.62rem] tracking-[0.16em] uppercase text-brass">{FORMAT[i.format] ?? i.format} · {when(i.scheduled_for)} {i.status === "approved" && "· ✓ en el calendario"}</p>
                  <IdeaPreview idea={i} watch={i.watch_id ? watches.get(i.watch_id) : undefined} video={i.watch_id ? videos.get(i.watch_id) : undefined} canVideo={canVideo} />
                  <p className="mt-3 font-display text-lg">{i.title}</p>
                  {i.why && <p className="mt-1 text-xs text-stone">{i.why}</p>}
                  {i.visual_brief && <p className="mt-2 text-xs">🎥 {i.visual_brief}</p>}
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-stone">Ver textos</summary>
                    <p className="mt-2 whitespace-pre-wrap text-xs">{i.caption_es}</p>
                    <p className="mt-2 whitespace-pre-wrap text-xs text-stone">{i.caption_en}</p>
                    <p className="mt-2 text-xs text-brass">{i.hashtags.join(" ")}</p>
                  </details>
                  <div className="mt-3 flex flex-wrap gap-3 text-[0.62rem] tracking-[0.16em] uppercase">
                    {i.status === "suggested" && <form action={ideaStatusAction.bind(null, i.id, "approved")}><button className="text-emerald-200 hover:text-ivory">✅ Aprobar</button></form>}
                    {i.status === "approved" && <form action={ideaStatusAction.bind(null, i.id, "posted")}><button className="text-emerald-200 hover:text-ivory">✓ Publicada</button></form>}
                    <form action={ideaStatusAction.bind(null, i.id, "dismissed")}><button className="text-stone hover:text-ivory">Descartar</button></form>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-stone">No hay ideas pendientes. Genera unas cuantas: también llegan solas al resumen de las 8:00 cuando las redes están flojas.</p>
          )}
        </Card>

        {/* 2 · Qué funciona */}
        <Card title={`Qué te funciona · ${insights.posts} publicaciones`}>
          <p className="mb-3 text-xs text-stone">Alcance medio por publicación ({n(insights.avgReach)}) y tasa de interacción ({(insights.avgEr * 100).toFixed(1)}%), por tipo. Primero, lo que más alcanza.</p>
          <div className="space-y-3 text-sm">
            {groups.filter(([, g]) => g.length).map(([label, g]) => (
              <div key={label}>
                <p className="text-[0.6rem] tracking-[0.16em] uppercase text-stone">{label}</p>
                <p>{g.map((x, k) => <span key={x.label} className={k === 0 ? "text-brass" : "text-stone"}>{k ? " · " : ""}{x.label} {n(x.reach)} ({(x.er * 100).toFixed(1)}%)</span>)}</p>
              </div>
            ))}
          </div>
          <p className="mt-4 text-[0.6rem] tracking-[0.16em] uppercase text-stone">Mejores publicaciones</p>
          <ul className="mt-1 space-y-1 text-xs">
            {insights.top.map((t) => <li key={t.permalink}><a href={t.permalink ?? "#"} target="_blank" rel="noreferrer" className="hover:text-brass">{t.date} · {t.format} · {n(t.reach)} alcance · {(t.er * 100).toFixed(1)}%</a> <span className="text-stone">{t.caption}</span></li>)}
          </ul>
        </Card>

        {/* 4 · Comentarios */}
        <Card title={`Comentarios sin responder · ${comments.length}`}>
          <form action={suggestRepliesAction} className="mb-3"><button className={ghostButtonClass}>Actualizar y sugerir respuestas</button></form>
          {comments.length ? (
            <ul className="space-y-4 text-sm">
              {comments.map((c) => (
                <li key={c.id} className="border-b border-line/60 pb-3">
                  <p><b>@{c.from_username ?? "alguien"}</b>: {c.text} {c.is_lead && <span className="text-xs text-amber-200">· interés de compra</span>}</p>
                  {c.permalink && <a href={c.permalink} target="_blank" rel="noreferrer" className="text-xs text-stone hover:text-ivory">Ver publicación →</a>}
                  <form action={replyCommentAction.bind(null, c.id)} className="mt-2 flex gap-2">
                    <input name="reply" defaultValue={c.suggested_reply ?? ""} placeholder="Respuesta pública…" className={fieldClass} />
                    <button className={ghostButtonClass}>Responder</button>
                  </form>
                  <form action={ignoreCommentAction.bind(null, c.id)}><button className="mt-1 text-[0.6rem] uppercase tracking-[0.16em] text-stone hover:text-ivory">No hace falta</button></form>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-stone">Todo respondido.</p>
          )}
        </Card>

        {/* 5 · Competencia */}
        <Card title="Competencia" className="xl:col-span-2">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-[0.6rem] tracking-[0.16em] uppercase text-stone">
                <tr><th className="pb-2 font-normal">Cuenta</th><th className="pb-2 text-right font-normal">Seguidores</th><th className="pb-2 text-right font-normal">Posts/semana</th><th className="pb-2 text-right font-normal">♥+💬 por post</th><th className="pb-2 text-right font-normal">Interacción</th><th className="pb-2 text-right font-normal">% Reels</th><th className="pb-2 pl-3 font-normal">Su mejor post</th></tr>
              </thead>
              <tbody>
                {board.map((c) => (
                  <tr key={c.username} className={`border-t border-line/60 ${c.mine ? "text-brass" : ""}`}>
                    <td className="py-2">@{c.username}{c.mine ? " (tú)" : ""}</td>
                    {c.error ? <td colSpan={6} className="py-2 text-xs text-stone">{c.error}</td> : (
                      <>
                        <td className="py-2 text-right tabular-nums">{n(c.followers)}{c.delta7 != null && <span className="block text-xs text-stone">{c.delta7 >= 0 ? "+" : ""}{c.delta7}</span>}</td>
                        <td className="py-2 text-right tabular-nums">{c.postsPerWeek ?? "—"}</td>
                        <td className="py-2 text-right tabular-nums">{n(c.avgInteractions)}</td>
                        <td className="py-2 text-right tabular-nums">{c.er == null ? "—" : `${(c.er * 100).toFixed(2)}%`}</td>
                        <td className="py-2 text-right tabular-nums">{c.reelsShare == null ? "—" : `${Math.round(c.reelsShare * 100)}%`}</td>
                        <td className="py-2 pl-3 text-xs">{c.best?.permalink ? <a href={c.best.permalink} target="_blank" rel="noreferrer" className="hover:text-ivory">{c.best.media_product_type === "REELS" ? "Reel" : "Post"} · ♥{n(c.best.like_count)} →</a> : "—"}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <form action={saveEngagementSettings} className="mt-4 grid gap-3 sm:grid-cols-2">
            <label><span className="mb-1.5 block text-[0.62rem] tracking-[0.22em] uppercase text-stone">Cuentas de la competencia (Instagram, separadas por comas)</span><input name="competitors" defaultValue={s.competitors ?? ""} placeholder="bobswatches, watchbox, crownandcaliber" className={fieldClass} /></label>
            <label><span className="mb-1.5 block text-[0.62rem] tracking-[0.22em] uppercase text-stone">Palabras de campaña («comenta PRECIO…»)</span><input name="comment_keywords" defaultValue={s.comment_keywords ?? ""} placeholder="PRECIO, INFO, PRICE" className={fieldClass} /></label>
            <p className="text-xs text-stone sm:col-span-2">Quien comente una palabra de campaña recibe la respuesta privada automática (actívala en Redes → Ajustes). Las cuentas de la competencia deben ser profesionales; sus datos se actualizan cada día.</p>
            <button className={`${ghostButtonClass} justify-self-start`}>Guardar</button>
          </form>
        </Card>
      </div>
    </>
  );
}
