import { tr } from "@/lib/admin-i18n";
import Link from "next/link";
import { kindOf } from "@/lib/clients";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { adminDb } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";
import type { Customer } from "@/lib/crm";
import { ago, Card, fmtDate, fmtDateTime, ghostButtonClass, money, SourceTag, StageBadge, requestTime } from "@/components/admin/ui";
import { LeadForm } from "@/components/admin/LeadForm";
import { addNote, addReminderAction, mergeAction, toggleTagAction, completeFollowUp, completeTaskAction, reminderDoneAction, setBot, setSocialBot, toggleAlert } from "../../../actions";
import { customerTasks, taskMessage, TASK_LABEL, waLink } from "@/lib/tasks";
import { customerValues } from "@/lib/customer-value";
import { getDocSettings } from "@/lib/documents";
import { todayInMiami } from "@/lib/booking";
import { CUSTOMER_TAGS, hasTag } from "@/lib/crm-labels";
import { duplicatesOf } from "@/lib/merge";
import { STATUS_LABEL, type DocKind, type DocStatus } from "@/lib/doc-labels";

export const metadata = { title: "Cliente" };

const EVENT_ICON: Record<string, string> = {
  shipment: "📦", payment_reminder: "💌", dealer_request: "🤝", tag: "🏷", merge: "🔗",
  lead: "✦", note: "✎", stage: "→", appointment: "📅", sell_request: "⌚", alert: "🔔", match: "✨", handoff: "👤", document: "📄", follow_up: "⏰", price_drop: "📉", purchase: "💰", return: "↩",
};
const SELL_LABEL: Record<string, string> = { new: "Nueva", offered: "Ofertada", accepted: "Aceptada", received: "Recibido", paid: "Pagada", rejected: "Rechazada" };

type Item = { at: string; kind: "event" | "msg"; icon: string; who: string; body: string; image?: string | null };

export default async function LeadPage({ params }: PageProps<"/admin/leads/[id]">) {
  await connection();
  // La plantilla y la página se generan en paralelo: cada página comprueba la sesión antes de leer datos
  await requireAdmin("leads");
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

  const [tasks, docSettings, values] = await Promise.all([customerTasks(id).catch(() => []), getDocSettings(), customerValues([id])]);
  const value = values.get(id);
  const { data: docs } = await db.from("documents").select("id, kind, number, status, total").eq("customer_id", id).order("created_at", { ascending: false });
  const dupes = await duplicatesOf(id);
  const { data: reminders } = await db.from("reminders").select("id, body, due_at, all_day, done_at").eq("customer_id", id).order("due_at", { ascending: false }).limit(20);
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

  const kind = await kindOf(c.id, c.stage, c.tags);
  const back = kind === "client" ? { href: "/admin/clientes", label: "Clientes" } : kind === "dealer" ? { href: `/admin/dealers/${c.id}`, label: "Ficha de dealer" } : { href: "/admin/leads", label: "Leads" };
  const now = requestTime();
  const waNumber = c.wa_id ?? c.phone?.replace(/\D/g, "");
  const botPaused = wa.data?.mode === "human" && wa.data.human_until && new Date(wa.data.human_until) > new Date(now);

  return (
    <>
      <Link href={back.href} className="text-[0.66rem] tracking-[0.2em] uppercase text-stone hover:text-ivory">← {tr(back.label)}</Link>
      <div className="mt-4 mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-light sm:text-4xl">{c.name ?? tr("Sin nombre")}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-stone">
            {value?.vip && <span className="border border-brass/60 px-2 py-0.5 text-[0.6rem] tracking-[0.2em] uppercase text-brass">{tr("⭐ VIP")}</span>}
            <StageBadge stage={c.stage} />
            <SourceTag source={c.source} />
            <span>{tr("· cliente desde")} {ago(c.created_at, now)}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {waNumber && <a href={`https://wa.me/${waNumber}`} target="_blank" rel="noreferrer" className={ghostButtonClass}>{tr("WhatsApp")}</a>}
          {c.ig_username && <a href={`https://ig.me/m/${c.ig_username}`} target="_blank" rel="noreferrer" className={ghostButtonClass}>{tr("Instagram @")}{c.ig_username}</a>}
          {c.phone && <a href={`tel:${c.phone}`} className={ghostButtonClass}>{tr("Llamar")}</a>}
          <Link href={`/admin/tareas?cliente=${c.id}`} className={ghostButtonClass}>{tr("+ Tarea")}</Link>
          {c.email && <a href={`mailto:${c.email}`} className={ghostButtonClass}>{tr("Correo")}</a>}
        </div>
      </div>

      {/* Etiquetas rápidas (VIP, Dealer…) y posibles fichas duplicadas */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        {[...CUSTOMER_TAGS, ...c.tags.filter((t) => !CUSTOMER_TAGS.some((x) => x.toLowerCase() === t.toLowerCase()))].map((t) => {
          const on = hasTag(c.tags, t);
          return (
            <form key={t} action={toggleTagAction.bind(null, c.id, t)}>
              <button className={`border px-3 py-1 text-[0.62rem] tracking-[0.16em] uppercase ${on ? "border-brass bg-brass/15 text-brass" : "border-line text-stone hover:text-ivory"}`}>{on ? "✓ " : "+ "}{t}</button>
            </form>
          );
        })}
      </div>
      {dupes.length > 0 && (
        <div className="mb-6 border border-amber-300/50 bg-amber-300/5 p-4 text-sm">
          <p>⚠️ <b>{tr("Puede que este cliente esté duplicado")}</b> {tr("(mismo teléfono, correo o nombre):")}</p>
          <ul className="mt-2 space-y-1.5">
            {dupes.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-3">
                <Link href={`/admin/leads/${d.id}`} className="text-brass hover:text-ivory">{d.name ?? tr("Sin nombre")}</Link>
                <span className="text-xs text-stone">{[d.phone, d.email].filter(Boolean).join(" · ")}</span>
                <form action={mergeAction.bind(null, c.id, d.id)}><button className="border border-line px-2.5 py-1 text-[0.6rem] tracking-[0.14em] uppercase text-stone hover:text-ivory">{tr("Fusionar en esta ficha")}</button></form>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          {c.follow_up_at && (
            <div className={`border p-4 ${c.follow_up_at <= todayInMiami(new Date(now)) ? "border-amber-300/50 bg-amber-300/5" : "border-line bg-forest/60"}`}>
              <p className="text-sm">
                ⏰ <b>{tr("Seguimiento")} {c.follow_up_at <= todayInMiami(new Date(now)) ? "pendiente" : "programado"}</b> · {fmtDate(`${c.follow_up_at}T12:00:00`)}
                {c.follow_up_note && <span className="text-stone"> · {c.follow_up_note}</span>}
              </p>
              <form action={completeFollowUp.bind(null, c.id)} className="mt-3 flex gap-2">
                <input name="done" placeholder={tr("Qué se hizo (opcional)")} className="w-full border border-line bg-ink/60 px-3 py-2 text-sm outline-none focus:border-brass/70" />
                <button className="whitespace-nowrap border border-line px-4 text-[0.66rem] tracking-[0.2em] uppercase text-stone hover:text-ivory">{tr("✓ Hecho")}</button>
              </form>
            </div>
          )}
          {value && (
            <div className="grid grid-cols-2 gap-px border border-line bg-line sm:grid-cols-4">
              {[
                ["Ha comprado", money(value.spent)],
                ["Compras", String(value.purchases)],
                ["Última compra", value.lastPurchase ? fmtDate(`${value.lastPurchase}T12:00:00`) : "—"],
                ["Nos vendió / consignó", String(value.supplied)],
              ].map(([l, v]) => (
                <div key={l} className="bg-forest px-4 py-3">
                  <p className="font-display text-2xl font-light">{v}</p>
                  <p className="mt-1 text-[0.58rem] tracking-[0.16em] uppercase text-stone">{l}</p>
                </div>
              ))}
            </div>
          )}

          {tasks.length > 0 && (
            <Card title="Postventa">
              <ul className="space-y-3 text-sm">
                {tasks.map((t) => {
                  const due = t.due_date <= todayInMiami(new Date(now));
                  const wa = waLink(c.wa_id ?? c.phone, taskMessage(t, c.name, c.lang, docSettings.doc_review_url));
                  return (
                    <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-line/60 pb-3">
                      <div>
                        <p className={due ? "text-amber-200" : ""}>{tr(TASK_LABEL[t.kind] ?? "Seguimiento")}</p>
                        <p className="text-xs text-stone">{t.note?.split(" · ")[0]} · {due ? tr("toca ya") : fmtDate(`${t.due_date}T12:00:00`)}</p>
                      </div>
                      <div className="flex gap-3 text-[0.62rem] tracking-[0.16em] uppercase">
                        {wa && <a href={wa} target="_blank" rel="noreferrer" className="text-brass hover:text-ivory">{tr("WhatsApp")}</a>}
                        <form action={completeTaskAction.bind(null, t.id)}><button className="text-stone hover:text-ivory">{tr("✓ Hecho")}</button></form>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
          <Card title="Datos del cliente"><LeadForm c={c} /></Card>

          {c.wa_id && wa.data && (
            <Card title="Bot de WhatsApp">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-stone">
                  {botPaused ? tr("Pausado: una persona atiende este chat.") : tr("Activo: el bot responde en este chat.")}
                </p>
                <form action={setBot.bind(null, c.wa_id, Boolean(botPaused))}>
                  <button className={ghostButtonClass}>{botPaused ? tr("Reactivar el bot") : tr("Pausar el bot")}</button>
                </form>
              </div>
            </Card>
          )}

          {(socialContacts ?? []).map((sc) => {
            const paused = sc.mode === "human" && sc.human_until && new Date(sc.human_until as string) > new Date(now);
            return (
              <Card key={sc.id as string} title={tr("Bot de {p}", { p: sc.platform === "facebook" ? "Messenger" : "Instagram" })}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-stone">{paused ? tr("Pausado: una persona atiende este chat.") : tr("Activo: el bot responde en este chat.")}</p>
                  <form action={setSocialBot.bind(null, sc.id as string, Boolean(paused))}>
                    <button className={ghostButtonClass}>{paused ? tr("Reactivar el bot") : tr("Pausar el bot")}</button>
                  </form>
                </div>
              </Card>
            );
          })}

          <Card title="Recordatorios">
            {reminders?.length ? (
              <ul className="mb-4 space-y-2 text-sm">
                {reminders.map((r) => (
                  <li key={r.id as string} className="flex items-start justify-between gap-3 border-b border-line/60 pb-2">
                    <span className={r.done_at ? "text-stone line-through" : ""}>
                      <span className="text-xs text-stone">{r.all_day ? fmtDate(r.due_at as string) : fmtDateTime(r.due_at as string)}</span> · {r.body as string}
                    </span>
                    {!r.done_at && <form action={reminderDoneAction.bind(null, r.id as string)}><button className="text-xs text-stone underline hover:text-ivory">{tr("Hecho")}</button></form>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mb-3 text-sm text-stone">{tr("Sin recordatorios. También se crean desde Telegram (⏰ Recordatorios).")}</p>
            )}
            <form action={addReminderAction.bind(null, c.id)} className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
              <input name="body" required placeholder={tr("Qué quiere o qué hacer (ej. busca Daytona panda)")} className="min-w-0 border border-line bg-ink/60 px-2 py-1.5 text-sm" />
              <input name="date" type="date" required min={todayInMiami(new Date(now))} className="border border-line bg-ink/60 px-2 py-1.5 text-sm" />
              <input name="time" type="time" step={900} aria-label={tr("Hora (opcional)")} className="border border-line bg-ink/60 px-2 py-1.5 text-sm" />
              <button className={ghostButtonClass}>{tr("Recordar")}</button>
            </form>
          </Card>

          <Card title="Búsquedas («avísenme»)">
            {alerts.data?.length ? (
              <ul className="space-y-2 text-sm">
                {alerts.data.map((a) => (
                  <li key={a.id as string} className="flex items-center justify-between gap-3 border-b border-line/60 pb-2">
                    <span className={a.active ? "" : "text-stone line-through"}>{a.query as string}</span>
                    <form action={toggleAlert.bind(null, a.id as string, !a.active)}>
                      <button className="text-xs text-stone underline hover:text-ivory">{a.active ? tr("Desactivar") : tr("Activar")}</button>
                    </form>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-stone">{tr("Sin búsquedas guardadas.")}</p>
            )}
          </Card>

          <Card title="Citas">
            <Link href={`/admin/citas?cliente=${c.id}#nueva`} className="mb-3 inline-block text-[0.62rem] tracking-[0.2em] uppercase text-brass hover:text-ivory">{tr("+ Nueva cita")}</Link>
            {appts.data?.length ? (
              <ul className="space-y-2 text-sm">
                {appts.data.map((a) => (
                  <li key={a.id as string} className="flex justify-between gap-3 border-b border-line/60 pb-2">
                    <span>{fmtDateTime(a.starts_at as string)} · {a.kind === "office" ? tr("Oficina") : tr("Video")}</span>
                    <span className="text-stone">{{ requested: "Pendiente", confirmed: "Confirmada", cancelled: "Cancelada" }[a.status as string]}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-stone">{tr("Sin citas.")}</p>
            )}
          </Card>

          <Card title="Documentos">
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
              <Link href={`/admin/documentos/nuevo?tipo=quote&cliente=${c.id}`} className="text-brass hover:text-ivory">{tr("+ Cotización")}</Link>
              <Link href={`/admin/documentos/nuevo?tipo=memo&cliente=${c.id}`} className="text-brass hover:text-ivory">{tr("+ Memo")}</Link>
              <Link href={`/admin/documentos/nuevo?tipo=invoice&cliente=${c.id}`} className="text-brass hover:text-ivory">{tr("+ Factura")}</Link>
              <Link href={`/admin/documentos/nuevo?tipo=consignment&cliente=${c.id}`} className="text-brass hover:text-ivory">{tr("+ Consignación")}</Link>
            </div>
          </Card>

          <Card title="Relojes que ofrece (vender / consignar)">
            {sells.data?.length ? (
              <ul className="space-y-4 text-sm">
                {sells.data.map((s) => (
                  <li key={s.id as string} className="border-b border-line/60 pb-3">
                    <div className="flex justify-between gap-3">
                      <Link href="/admin/compras" className="hover:text-brass">{[s.brand, s.model, s.reference].filter(Boolean).join(" ")}</Link>
                      <span className="text-stone">{tr(SELL_LABEL[s.status as string] ?? s.status)} · {money(s.offer_amount as number | null)}</span>
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
              <p className="text-sm text-stone">{tr("Ninguno.")}</p>
            )}
          </Card>
        </div>

        <Card title="Historial">
          <form action={addNote.bind(null, c.id)} className="mb-5 flex gap-2">
            <input name="note" placeholder={tr("Añadir una nota (llamada, visita, acuerdo…)")} className="w-full border border-line bg-ink/60 px-3 py-2.5 text-sm outline-none focus:border-brass/70" />
            <button className="border border-line px-4 text-[0.66rem] tracking-[0.2em] uppercase text-stone hover:text-ivory">{tr("Añadir")}</button>
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
            {!timeline.length && <p className="text-sm text-stone">{tr("Sin actividad todavía.")}</p>}
          </ol>
        </Card>
      </div>
    </>
  );
}
