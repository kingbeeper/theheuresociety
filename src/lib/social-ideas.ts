import "server-only";
import { adminDb } from "./supabase";
import { escapeHtml as h, keyboard, notifyAdmins, sendMessage } from "./telegram";
import type { Idea } from "./social-growth";
import { TIME_ZONE } from "./booking";

// Ideas de publicación por Telegram: propuesta con botones (aprobar, video, descartar) y
// recordatorio el día que toca, con el texto listo para copiar.

const FORMAT: Record<string, string> = { reel: "🎬 Reel", carousel: "🖼 Carrusel", post: "📷 Foto", story: "⭕ Story" };
const when = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("es-ES", { timeZone: TIME_ZONE, weekday: "long", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : "—";

async function watchLabel(id: string | null) {
  if (!id) return null;
  const { data } = await adminDb().from("watches").select("brand, model, reference").eq("id", id).maybeSingle();
  return data ? `${data.brand} ${data.model} · ${data.reference}` : null;
}

export async function ideaMessage(i: Idea, mode: "proposal" | "reminder") {
  const watch = await watchLabel(i.watch_id);
  const head = mode === "reminder" ? `📅 <b>Hoy toca publicar</b> · ${when(i.scheduled_for)}` : `💡 <b>Idea para publicar</b> · ${when(i.scheduled_for)}`;
  const text = [
    head,
    `${FORMAT[i.format] ?? i.format} · <b>${h(i.title)}</b>${watch ? `\n⌚ ${h(watch)}` : ""}`,
    i.why ? `<i>${h(i.why)}</i>` : "",
    i.visual_brief ? `🎥 ${h(i.visual_brief)}` : "",
    "",
    `<b>ES</b>\n<code>${h(i.caption_es ?? "")}</code>`,
    `<b>EN</b>\n<code>${h(i.caption_en ?? "")}</code>`,
    `<code>${h(i.hashtags.join(" "))}</code>`,
  ].filter(Boolean).join("\n");
  const rows = mode === "proposal"
    ? [[{ text: "✅ Aprobar (al calendario)", callback_data: `dcid:${i.id}|ok` }], ...(i.watch_id ? [[{ text: "🎬 Hacer su video promocional", callback_data: `mvid:${i.watch_id}` }]] : []), [{ text: "❌ Descartar", callback_data: `dcid:${i.id}|no` }]]
    : [[{ text: "✓ Ya lo publiqué", callback_data: `dcid:${i.id}|posted` }], ...(i.watch_id ? [[{ text: "🎬 Video promocional", callback_data: `mvid:${i.watch_id}` }]] : [])];
  return { text: text.slice(0, 4000), extra: { reply_markup: keyboard(rows) } };
}

export async function sendIdeas(ideas: Idea[], chatId?: number) {
  for (const i of ideas) {
    const m = await ideaMessage(i, "proposal");
    if (chatId) await sendMessage(chatId, m.text, m.extra);
    else await notifyAdmins(m.text, m.extra);
  }
}

// Recordatorio de las ideas aprobadas para hoy (desde el resumen de las 8:00)
export async function remindToday(now = Date.now()) {
  const db = adminDb();
  const end = new Date(now + 24 * 3_600_000).toISOString();
  const { data } = await db.from("content_ideas").select("*").eq("status", "approved").is("reminded_at", null).lte("scheduled_for", end).order("scheduled_for");
  for (const i of (data ?? []) as Idea[]) {
    const m = await ideaMessage(i, "reminder");
    await notifyAdmins(m.text, m.extra).catch(() => {});
    await db.from("content_ideas").update({ reminded_at: new Date().toISOString() }).eq("id", i.id);
  }
  return data?.length ?? 0;
}

export async function setIdeaStatus(id: string, status: "approved" | "dismissed" | "posted") {
  await adminDb().from("content_ideas").update({ status }).eq("id", id);
}
