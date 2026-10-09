import Link from "next/link";
import { connection } from "next/server";
import { adminDb } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";
import { DEFAULT_COMMENT_REPLY, getSettings, META_APP_ID, META_SCOPES } from "@/lib/meta";
import { SITE_URL } from "@/lib/seo";
import { ago, Card, fmtDate, PageTitle, requestTime } from "@/components/admin/ui";
import { ConnectMeta, SyncButton } from "@/components/admin/ConnectMeta";
import { disconnectSocial, saveSocialSettings } from "../../actions";

export const metadata = { title: "Redes" };

type Daily = { day: string; platform: string; data: Record<string, number> };
type Post = {
  id: string; platform: string; product_type: string | null; media_type: string | null; caption: string | null; permalink: string | null;
  thumbnail_url: string | null; posted_at: string | null; metrics: Record<string, number>;
};

const fmt = (n: number | null | undefined) => (n == null ? "—" : new Intl.NumberFormat("es-ES").format(Math.round(n)));
const SORTS = { reach: "Alcance", views: "Visualizaciones", interactions: "Interacciones", saved: "Guardados", leads: "Leads" } as const;

export default async function RedesPage({ searchParams }: PageProps<"/admin/redes">) {
  await connection();
  await requireAdmin("redes");
  const sp = await searchParams;
  const sort = (typeof sp.sort === "string" && sp.sort in SORTS ? sp.sort : "reach") as keyof typeof SORTS;
  const platform = sp.platform === "facebook" ? "facebook" : sp.platform === "instagram" ? "instagram" : "";

  const s = await getSettings();
  const connected = Boolean(s.page_token && s.page_id);
  const now = requestTime();
  const db = adminDb();

  const [daily, posts, leadComments, recentComments, waiting] = connected
    ? await Promise.all([
        db.from("social_daily").select("*").gte("day", new Date(now - 60 * 86_400_000).toISOString().slice(0, 10)).order("day"),
        db.from("social_posts").select("*").order("posted_at", { ascending: false }).limit(150),
        db.from("social_comments").select("post_id").eq("is_lead", true),
        db.from("social_comments").select("*").eq("is_lead", true).order("created_at", { ascending: false }).limit(12),
        db.from("social_contacts").select("id", { count: "exact", head: true }).eq("mode", "human").gt("human_until", new Date(now).toISOString()),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }, { count: 0 }];

  const rows = (daily.data ?? []) as Daily[];
  const leadsByPost = (leadComments.data ?? []).reduce<Record<string, number>>((acc, c) => {
    if (c.post_id) acc[c.post_id as string] = (acc[c.post_id as string] ?? 0) + 1;
    return acc;
  }, {});

  // Resumen de una red: seguidores (y su variación) y sumas de los últimos 7 días
  const summary = (p: string) => {
    const r = rows.filter((d) => d.platform === p);
    const withFollowers = r.filter((d) => d.data.followers != null);
    const followers = withFollowers.at(-1)?.data.followers ?? null;
    const ago30 = withFollowers.find((d) => new Date(d.day).getTime() >= now - 31 * 86_400_000)?.data.followers ?? null;
    const last7 = r.filter((d) => new Date(d.day).getTime() >= now - 7 * 86_400_000);
    const sum = (k: string) => (last7.some((d) => d.data[k] != null) ? last7.reduce((a, d) => a + (d.data[k] ?? 0), 0) : null);
    return { followers, delta: followers != null && ago30 != null ? followers - ago30 : null, sum, series: r.slice(-30) };
  };
  const ig = summary("instagram");
  const fb = summary("facebook");

  const score = (p: Post) =>
    sort === "leads" ? leadsByPost[p.id] ?? 0
    : sort === "interactions" ? p.metrics.total_interactions ?? (p.metrics.likes ?? 0) + (p.metrics.comments ?? 0) + (p.metrics.reactions ?? 0) + (p.metrics.shares ?? 0) + (p.metrics.saved ?? 0)
    : p.metrics[sort] ?? 0;
  const list = ((posts.data ?? []) as Post[]).filter((p) => !platform || p.platform === platform).sort((a, b) => score(b) - score(a)).slice(0, 30);

  const link = (params: Record<string, string>) => `/admin/redes?${new URLSearchParams({ sort, ...(platform && { platform }), ...params })}`;

  return (
    <>
      <PageTitle eyebrow="CRM" title="Redes" action={connected ? <SyncButton /> : undefined} />

      {!connected ? (
        <Card title="Conectar Instagram y Facebook">
          <p className="mb-5 max-w-2xl text-sm leading-relaxed text-stone">
            Conecta la página de Facebook de The Heure Society y su Instagram vinculado para ver aquí las métricas de cada publicación,
            convertir los DM y los comentarios de interés en leads y, si quieres, que el asistente responda los mensajes.
            Inicia sesión con la cuenta de Facebook que administra la página.
          </p>
          {META_APP_ID ? (
            <ConnectMeta appId={META_APP_ID} scopes={META_SCOPES} configId={process.env.NEXT_PUBLIC_META_LOGIN_CONFIG_ID} />
          ) : (
            <p className="border-l border-brass/60 pl-4 text-sm text-stone">Falta crear la app de Meta (NEXT_PUBLIC_META_APP_ID).</p>
          )}
        </Card>
      ) : (
        <>
          <p className="-mt-4 mb-6 text-sm text-stone">
            {s.page_name}{s.ig_username ? ` · @${s.ig_username}` : ""} · conectado {s.connected_at ? ago(s.connected_at, now) : ""}
            {waiting.count ? <> · <Link href="/admin/leads?source=instagram" className="text-brass">{waiting.count} chat(s) esperando a una persona</Link></> : null}
          </p>

          {/* Cifras clave */}
          <div className="grid gap-px border border-line bg-line md:grid-cols-2">
            {[
              { name: "Instagram", d: ig, keys: [["Alcance", "reach"], ["Visualizaciones", "views"], ["Interacciones", "total_interactions"], ["Clics en el perfil", "profile_links_taps"]] },
              { name: "Facebook", d: fb, keys: [["Alcance", "reach"], ["Visualizaciones", "views"], ["Interacciones", "interactions"], ["Visitas a la página", "page_views"]] },
            ].map(({ name, d, keys }) => (
              <div key={name} className="bg-forest p-5">
                <p className="text-[0.66rem] tracking-[0.24em] uppercase text-brass">{name}</p>
                <div className="mt-3 flex items-baseline gap-3">
                  <p className="font-display text-3xl font-light sm:text-4xl">{fmt(d.followers)}</p>
                  <p className="text-xs text-stone">
                    seguidores{d.delta != null ? <span className={d.delta >= 0 ? "text-emerald-200" : "text-red-200"}> · {d.delta >= 0 ? "+" : ""}{fmt(d.delta)} en 30 días</span> : null}
                  </p>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {keys.map(([label, k]) => (
                    <div key={k}>
                      <p className="text-lg tabular-nums">{fmt(d.sum(k))}</p>
                      <p className="text-[0.6rem] tracking-[0.16em] uppercase text-stone">{label} · 7 d</p>
                    </div>
                  ))}
                </div>
                {/* Alcance diario de los últimos 30 días */}
                <Bars values={d.series.map((x) => ({ day: x.day, v: x.data.reach ?? 0 }))} />
              </div>
            ))}
          </div>

          <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <Card title="Publicaciones">
              <div className="mb-4 flex flex-wrap items-center gap-2 text-[0.62rem] tracking-[0.18em] uppercase">
                <span className="text-stone">Ordenar:</span>
                {Object.entries(SORTS).map(([k, v]) => (
                  <Link key={k} href={link({ sort: k })} className={`border px-2 py-1 ${sort === k ? "border-brass text-ivory" : "border-line text-stone hover:text-ivory"}`}>{v}</Link>
                ))}
                <span className="ml-2 text-stone">Red:</span>
                {[["", "Todas"], ["instagram", "Instagram"], ["facebook", "Facebook"]].map(([k, v]) => (
                  <Link key={k || "all"} href={`/admin/redes?${new URLSearchParams({ sort, ...(k && { platform: k }) })}`} className={`border px-2 py-1 ${platform === k ? "border-brass text-ivory" : "border-line text-stone hover:text-ivory"}`}>{v}</Link>
                ))}
              </div>
              {list.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-sm">
                    <thead className="text-left text-[0.6rem] tracking-[0.18em] uppercase text-stone">
                      <tr>
                        <th className="pb-2 font-normal">Publicación</th>
                        <th className="pb-2 text-right font-normal">Alcance</th>
                        <th className="pb-2 text-right font-normal">Vistas</th>
                        <th className="pb-2 text-right font-normal">Me gusta</th>
                        <th className="pb-2 text-right font-normal">Coment.</th>
                        <th className="pb-2 text-right font-normal">Guard.</th>
                        <th className="pb-2 text-right font-normal">Compart.</th>
                        <th className="pb-2 text-right font-normal text-brass">Leads</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line/60">
                      {list.map((p) => (
                        <tr key={p.id}>
                          <td className="py-2.5 pr-3">
                            <a href={p.permalink ?? "#"} target="_blank" rel="noreferrer" className="flex items-center gap-3 hover:text-brass">
                              {p.thumbnail_url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={p.thumbnail_url} alt="" className="h-11 w-11 shrink-0 object-cover" />
                              ) : (
                                <span className="h-11 w-11 shrink-0 bg-moss" />
                              )}
                              <span className="min-w-0">
                                <span className="line-clamp-1">{p.caption?.split("\n")[0] || "(sin texto)"}</span>
                                <span className="text-xs text-stone">
                                  {p.platform === "instagram" ? (p.product_type === "REELS" ? "Reel" : p.media_type === "CAROUSEL_ALBUM" ? "Carrusel" : "Post") : "Facebook"}
                                  {p.posted_at ? ` · ${fmtDate(p.posted_at)}` : ""}
                                </span>
                              </span>
                            </a>
                          </td>
                          <td className="text-right tabular-nums">{fmt(p.metrics.reach)}</td>
                          <td className="text-right tabular-nums">{fmt(p.metrics.views)}</td>
                          <td className="text-right tabular-nums">{fmt(p.metrics.likes ?? p.metrics.reactions)}</td>
                          <td className="text-right tabular-nums">{fmt(p.metrics.comments)}</td>
                          <td className="text-right tabular-nums">{fmt(p.metrics.saved)}</td>
                          <td className="text-right tabular-nums">{fmt(p.metrics.shares)}</td>
                          <td className="text-right tabular-nums text-brass">{leadsByPost[p.id] ?? 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-stone">Aún no hay publicaciones. Pulsa «Actualizar» para traer las métricas.</p>
              )}
            </Card>

            <div className="space-y-6">
              <Card title="Comentarios con interés">
                {recentComments.data?.length ? (
                  <ul className="space-y-3 text-sm">
                    {recentComments.data.map((c) => (
                      <li key={c.id as string} className="border-b border-line/60 pb-3">
                        <p>
                          {c.customer_id ? (
                            <Link href={`/admin/leads/${c.customer_id}`} className="hover:text-brass">{(c.from_username as string) ?? "Alguien"}</Link>
                          ) : (
                            (c.from_username as string) ?? "Alguien"
                          )}
                          <span className="text-stone"> · {ago(c.created_at as string, now)}{c.replied_at ? " · respondido por DM" : ""}</span>
                        </p>
                        <p className="mt-1 text-stone">«{c.text as string}»</p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-stone">Los comentarios que pregunten por precio o disponibilidad aparecerán aquí y como leads.</p>
                )}
              </Card>

              <Card title="Ajustes">
                <form action={saveSocialSettings} className="space-y-4 text-sm">
                  <label className="flex items-start gap-3">
                    <input type="checkbox" name="bot_dm" defaultChecked={s.bot_dm !== "off"} className="mt-1 accent-[#c8b07a]" />
                    <span>
                      El asistente responde los DM de Instagram y Messenger
                      <span className="block text-xs text-stone">Si escribes tú en un chat, el bot se aparta 12 h.</span>
                    </span>
                  </label>
                  <label className="flex items-start gap-3">
                    <input type="checkbox" name="comment_reply" defaultChecked={s.comment_reply === "on"} className="mt-1 accent-[#c8b07a]" />
                    <span>
                      Responder por DM a los comentarios de interés (una vez por comentario)
                      <span className="block text-xs text-stone">Si la persona contesta, sigue el asistente en el DM.</span>
                    </span>
                  </label>
                  <textarea name="comment_reply_text" rows={3} defaultValue={s.comment_reply_text || DEFAULT_COMMENT_REPLY} className="w-full border border-line bg-ink/60 px-3 py-2 text-sm outline-none focus:border-brass/70" />
                  <button className="bg-ivory px-5 py-2.5 text-[0.68rem] tracking-[0.22em] uppercase text-ink hover:bg-brass">Guardar</button>
                </form>
              </Card>

              <Card title="Conexión">
                <p className="text-xs leading-relaxed text-stone">
                  Avisos de Meta (webhook): <span className="break-all text-ivory">{SITE_URL}/api/meta</span>
                </p>
                <div className="mt-4 flex flex-wrap gap-3">
                  {META_APP_ID && <ConnectMeta appId={META_APP_ID} scopes={META_SCOPES} configId={process.env.NEXT_PUBLIC_META_LOGIN_CONFIG_ID} label="Reconectar" />}
                  <form action={disconnectSocial}>
                    <button className="border border-line px-4 py-2.5 text-[0.66rem] tracking-[0.2em] uppercase text-stone hover:text-ivory">Desconectar</button>
                  </form>
                </div>
              </Card>
            </div>
          </div>
        </>
      )}
    </>
  );
}

// Gráfico de barras sencillo (alcance diario)
function Bars({ values }: { values: { day: string; v: number }[] }) {
  if (!values.some((x) => x.v)) return <p className="mt-5 text-xs text-stone">El gráfico de alcance aparecerá tras la primera actualización.</p>;
  const max = Math.max(...values.map((x) => x.v), 1);
  return (
    <div className="mt-5">
      <div className="flex h-20 items-end gap-[3px]">
        {values.map((x) => (
          <span key={x.day} title={`${x.day}: ${x.v}`} className="flex-1 bg-brass/60 hover:bg-brass" style={{ height: `${Math.max((x.v / max) * 100, 2)}%` }} />
        ))}
      </div>
      <p className="mt-1 flex justify-between text-[0.6rem] text-stone">
        <span>{values[0]?.day.slice(5)}</span>
        <span>Alcance diario</span>
        <span>{values.at(-1)?.day.slice(5)}</span>
      </p>
    </div>
  );
}
