import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { adminDb } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";
import type { Customer } from "@/lib/crm";
import { ago, Card, fmtDate, fmtDateTime, ghostButtonClass, money, SourceTag, StageBadge, requestTime } from "@/components/admin/ui";
import { LeadForm } from "@/components/admin/LeadForm";
import { addNote, completeFollowUp, setBot, setSocialBot, toggleAlert } from "../../../actions";
import { todayInMiami } from "@/lib/booking";
import { STATUS_LABEL, type DocKind, type DocStatus } from "@/lib/doc-labels";

export const metadata = { title: "Cliente" };

const EVENT_ICON: Record<string, string> = {
  lead: "✦", note: "✎", stage: "→", appointment: "📅", sell_request: "⌚", alert: "🔔", match: "✨", handoff: "👤", document: "📄", follow_up: "⏰", price_drop: "📉", purchase: "💰", return: "↩",
};
const SELL_LABEL: Record<string, string> = { new: "Nueva", offered: "Ofertada", accepted: "Aceptada", received: "Recibido", paid: "Pagada", rejected: "Rechazada" };

type Item = { at: string; kind: "event" | "msg"; icon: string; who: string; body: string; image?: string | null };

export default async function LeadPage({ params }: PageProps<"/admin/leads/[id]">) {
  await connection();
  // La plantilla y la página se generan en paralelo: cada página comprueba la sesión antes de leer datos
  await requireAdmin();
  const { id } = await params;
  const db = adminDb();
  const { data } = await db.from("customers").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const c = data as Customer;

  // Conversaciones por Instagram o Messenger (si las tablas de redes aún no existen, quedan vacías)
  const { data: socialContacts } = await db.from("social_contacts").select("id, platform, username, mode, human_until").eq("customer_id", id);
  const socialIds = (socialContacts ?? []).map((s) => s.id as string);
  const { data: socialMsgs } = socialIds.length
    ? await db.from("social_messages").select("contact_id, direction, type, body, media_url, created_at").in("contact_id", socialIds).order("created_at", { ascending: false }).limit(150)
    : { data: [] as { contact_id: string; direction: string; type: string; body: string | null; media_url: string | null; created_at: string }[] };
  const platformOf = (contactId: string) => (socialContacts ?? []).find((s) => s.id === contactId)?.platform === "facebook" ? "Messenger" : "Instagram";

  const { data: docs } = await db.from("documents").select("id, kind, number, status, total").eq("customer_id", id).order("created_at", { ascending: false });
  const [events, alerts, appts, sells, wa, msgs] = await Promise.all([
    db.from("customer_events").select("*").eq("customer_id", id).order("created_at", { ascending: false }).limit(200),
    db.from("watch_alerts").select("*").eq("customer_id", id).order("created_at", { ascending: false }),
    db.from("appointments").select("*").eq("customer_id", id).order("starts_at", { ascending: false }),
    db.from("sell_requests").select("*").eq("customer_id", id).order("created_at", { ascending: false }),
    c.wa_id ? db.from("wa_contacts").select("mode, human_until").eq("wa_id", c.wa_id).maybeSingle() : Promise.resolve({ data: null }),
    c.wa_id
      ? db.from("wa_messages").select("direction, type, body, media_url, created_at").eq("wa_id", c.wa_id).order("created_at", { ascending: false }).limit(150)
      : Promise.resolve({ data: [] as { direction: string; type: string; body: string | null; media_url: string | null; created_at: string }[] }),
  ]);

  // Historial: eventos del CRM y conversación de WhatsApp, del más reciente al más antiguo
  const timeline: Item[] = [
    ...(events.data ?? []).map((e) => ({
      at: e.created_at as string, kind: "event" as const, icon: EVENT_ICON[e.type as string] ?? "•",
      who: (e.created_by as string) ?? "", body: e.body as string,
    })),
    ...(msgs.data ?? []).map((m) => ({
      at: m.created_at, kind: "msg" as const, icon: m.direction === "in" ? "💬" : m.direction === "bot" ? "🤖" : "🧑‍💼",
      who: m.direction === "in" ? c.name ?? "Cliente" : m.direction === "bot" ? "Bot" : "Equipo",
      body: m.body ?? (m.type === "image" ? "[Foto]" : `[${m.type}]`), image: m.type === "image" ? m.media_url : null,
    })),
    ...(socialMsgs ?? []).map((m) => ({
      at: m.created_at as string, kind: "msg" as const, icon: m.direction === "in" ? "📸" : m.direction === "bot" ? "🤖" : "🧑‍💼",
      who: `${m.direction === "in" ? c.name ?? "Cliente" : m.direction === "bot" ? "Bot" : "Equipo"} · ${platformOf(m.contact_id as string)}`,
      body: (m.body as string | null) ?? (m.type === "image" ? "[Foto]" : `[${m.type}]`), image: m.type === "image" ? (m.media_url as string | null) : null,
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  const now = requestTime();
  const waNumber = c.wa_id ?? c.phone?.replace(/\D/g, "");
  const botPaused = wa.data?.mode === "human" && wa.data.human_until && new Date(wa.data.human_until) > new Date(now);

  return (
    <>
      <Link href="/admin/leads" className="text-[0.66rem] tracking-[0.2em] uppercase text-stone hover:text-ivory">← Leads</Link>
      <div className="mt-4 mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl font-light">{c.name ?? "Sin nombre"}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-stone">
            <StageBadge stage={c.stage} />
            <SourceTag source={c.source} />
            <span>· cliente desde {ago(c.created_at, now)}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {waNumber && <a href={`https://wa.me/${waNumber}`} target="_blank" rel="noreferrer" className={ghostButtonClass}>WhatsApp</a>}
          {c.ig_username && <a href={`https://ig.me/m/${c.ig_username}`} target="_blank" rel="noreferrer" className={ghostButtonClass}>Instagram @{c.ig_username}</a>}
          {c.phone && <a href={`tel:${c.phone}`} className={ghostButtonClass}>Llamar</a>}
          {c.email && <a href={`mailto:${c.email}`} className={ghostButtonClass}>Correo</a>}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          {c.follow_up_at && (
            <div className={`border p-4 ${c.follow_up_at <= todayInMiami(new Date(now)) ? "border-amber-300/50 bg-amber-300/5" : "border-line bg-forest/60"}`}>
              <p className="text-sm">
                ⏰ <b>Seguimiento {c.follow_up_at <= todayInMiami(new Date(now)) ? "pendiente" : "programado"}</b> · {fmtDate(`${c.follow_up_at}T12:00:00`)}
                {c.follow_up_note && <span className="text-stone"> · {c.follow_up_note}</span>}
              </p>
              <form action={completeFollowUp.bind(null, c.id)} className="mt-3 flex gap-2">
                <input name="done" placeholder="Qué se hizo (opcional)" className="w-full border border-line bg-ink/60 px-3 py-2 text-sm outline-none focus:border-brass/70" />
                <button className="whitespace-nowrap border border-line px-4 text-[0.66rem] tracking-[0.2em] uppercase text-stone hover:text-ivory">✓ Hecho</button>
              </form>
            </div>
          )}
          <Card title="Datos del cliente"><LeadForm c={c} /></Card>

          {c.wa_id && wa.data && (
            <Card title="Bot de WhatsApp">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-stone">
                  {botPaused ? "Pausado: una persona atiende este chat." : "Activo: el bot responde en este chat."}
                </p>
                <form action={setBot.bind(null, c.wa_id, Boolean(botPaused))}>
                  <button className={ghostButtonClass}>{botPaused ? "Reactivar el bot" : "Pausar el bot"}</button>
                </form>
              </div>
            </Card>
          )}

          {(socialContacts ?? []).map((sc) => {
            const paused = sc.mode === "human" && sc.human_until && new Date(sc.human_until as string) > new Date(now);
            return (
              <Card key={sc.id as string} title={`Bot de ${sc.platform === "facebook" ? "Messenger" : "Instagram"}`}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-stone">{paused ? "Pausado: una persona atiende este chat." : "Activo: el bot responde en este chat."}</p>
                  <form action={setSocialBot.bind(null, sc.id as string, Boolean(paused))}>
                    <button className={ghostButtonClass}>{paused ? "Reactivar el bot" : "Pausar el bot"}</button>
                  </form>
                </div>
              </Card>
            );
          })}

          <Card title="Búsquedas («avísenme»)">
            {alerts.data?.length ? (
              <ul className="space-y-2 text-sm">
                {alerts.data.map((a) => (
                  <li key={a.id as string} className="flex items-center justify-between gap-3 border-b border-line/60 pb-2">
                    <span className={a.active ? "" : "text-stone line-through"}>{a.query as string}</span>
                    <form action={toggleAlert.bind(null, a.id as string, !a.active)}>
                      <button className="text-xs text-stone underline hover:text-ivory">{a.active ? "Desactivar" : "Activar"}</button>
                    </form>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-stone">Sin búsquedas guardadas.</p>
            )}
          </Card>

          <Card title="Citas">
            <Link href={`/admin/citas?cliente=${c.id}#nueva`} className="mb-3 inline-block text-[0.62rem] tracking-[0.2em] uppercase text-brass hover:text-ivory">+ Nueva cita</Link>
            {appts.data?.length ? (
              <ul className="space-y-2 text-sm">
                {appts.data.map((a) => (
                  <li key={a.id as string} className="flex justify-between gap-3 border-b border-line/60 pb-2">
                    <span>{fmtDateTime(a.starts_at as string)} · {a.kind === "office" ? "Oficina" : "Video"}</span>
                    <span className="text-stone">{{ requested: "Pendiente", confirmed: "Confirmada", cancelled: "Cancelada" }[a.status as string]}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-stone">Sin citas.</p>
            )}
          </Card>

          <Card title="Cotizaciones, memos y facturas">
            {docs?.length ? (
              <ul className="mb-3 space-y-2 text-sm">
                {docs.map((d) => (
                  <li key={d.id as string} className="flex justify-between gap-3 border-b border-line/60 pb-2">
                    <Link href={`/admin/documentos/${d.id}`} className="hover:text-brass">{d.number as string}</Link>
                    <span className="text-stone">{STATUS_LABEL[d.kind as DocKind][d.status as DocStatus]} · {money(d.total as number)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="flex flex-wrap gap-3 text-[0.62rem] tracking-[0.2em] uppercase">
              <Link href={`/admin/documentos/nuevo?tipo=quote&cliente=${c.id}`} className="text-brass hover:text-ivory">+ Cotización</Link>
              <Link href={`/admin/documentos/nuevo?tipo=memo&cliente=${c.id}`} className="text-brass hover:text-ivory">+ Memo</Link>
              <Link href={`/admin/documentos/nuevo?tipo=invoice&cliente=${c.id}`} className="text-brass hover:text-ivory">+ Factura</Link>
            </div>
          </Card>

          <Card title="Relojes que ofrece (vender / consignar)">
            {sells.data?.length ? (
              <ul className="space-y-4 text-sm">
                {sells.data.map((s) => (
                  <li key={s.id as string} className="border-b border-line/60 pb-3">
                    <div className="flex justify-between gap-3">
                      <Link href="/admin/compras" className="hover:text-brass">{[s.brand, s.model, s.reference].filter(Boolean).join(" ")}</Link>
                      <span className="text-stone">{SELL_LABEL[s.status as string] ?? s.status} · {money(s.offer_amount as number | null)}</span>
                    </div>
                    {(s.image_paths as string[])?.length > 0 && (
                      <div className="mt-2 flex gap-2 overflow-x-auto">
                        {(s.image_paths as string[]).map((u) => (
                          <a key={u} href={u} target="_blank" rel="noreferrer">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={u} alt="" className="h-16 w-16 object-cover" />
                          </a>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-stone">Ninguno.</p>
            )}
          </Card>
        </div>

        <Card title="Historial">
          <form action={addNote.bind(null, c.id)} className="mb-5 flex gap-2">
            <input name="note" placeholder="Añadir una nota (llamada, visita, acuerdo…)" className="w-full border border-line bg-ink/60 px-3 py-2.5 text-sm outline-none focus:border-brass/70" />
            <button className="border border-line px-4 text-[0.66rem] tracking-[0.2em] uppercase text-stone hover:text-ivory">Añadir</button>
          </form>
          <ol className="space-y-3">
            {timeline.map((t, i) => (
              <li key={i} className={`border-l-2 pl-3 ${t.kind === "msg" ? "border-line" : "border-brass/50"}`}>
                <p className="text-[0.66rem] tracking-[0.12em] text-stone">
                  {t.icon} {t.who && `${t.who} · `}{fmtDateTime(t.at)}
                </p>
                <p className="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed">{t.body}</p>
                {t.image && (
                  <a href={t.image} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={t.image} alt="" className="mt-2 h-24 w-24 object-cover" />
                  </a>
                )}
              </li>
            ))}
            {!timeline.length && <p className="text-sm text-stone">Sin actividad todavía.</p>}
          </ol>
        </Card>
      </div>
    </>
  );
}
