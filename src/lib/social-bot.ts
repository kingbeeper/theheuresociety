import "server-only";
import { adminDb, PHOTO_BUCKET } from "./supabase";
import { getWatches } from "./inventory";
import { isBookable, miamiToUtc, TIME_ZONE, upcomingSlots } from "./booking";
import { runAgent, type HistoryItem } from "./wa-agent";
import { addEvent, addWatchAlert, upsertLead } from "./crm";
import { escapeHtml as h, notifyAdmins } from "./telegram";
import { DEFAULT_COMMENT_REPLY, getSettings, graph, type SocialSettings } from "./meta";

// DM de Instagram, Messenger y comentarios en las publicaciones. Cada persona se convierte en
// lead del CRM; el mismo asistente de WhatsApp responde los DM (si está activado en el CRM).

type Platform = "instagram" | "facebook";
const HUMAN_HOURS = 12;
const DEBOUNCE_MS = 4000;

type Messaging = {
  sender: { id: string };
  recipient: { id: string };
  timestamp: number;
  message?: {
    mid: string;
    text?: string;
    is_echo?: boolean;
    is_deleted?: boolean;
    is_unsupported?: boolean;
    attachments?: { type: string; payload?: { url?: string } }[];
    reply_to?: { story?: { url?: string } };
  };
  postback?: { title?: string; payload?: string; mid?: string };
};
type Change = { field: string; value: Record<string, unknown> };
export type MetaWebhook = { object?: string; entry?: { id: string; messaging?: Messaging[]; changes?: Change[] }[] };

// ───────────────────────────── Entrada ─────────────────────────────
export async function handleMetaWebhook(payload: MetaWebhook) {
  const platform: Platform | null = payload.object === "instagram" ? "instagram" : payload.object === "page" ? "facebook" : null;
  if (!platform) return;
  const s = await getSettings();
  if (!s.page_token) return;

  for (const entry of payload.entry ?? []) {
    for (const m of entry.messaging ?? []) {
      try {
        await handleMessage(platform, m, s);
      } catch (e) {
        console.error("DM de Meta:", e);
      }
    }
    for (const c of entry.changes ?? []) {
      try {
        if (platform === "instagram" && c.field === "comments") await handleComment("instagram", igComment(c.value), s);
        if (platform === "facebook" && c.field === "feed" && c.value.item === "comment" && c.value.verb === "add") await handleComment("facebook", fbComment(c.value), s);
      } catch (e) {
        console.error("Comentario de Meta:", e);
      }
    }
  }
}

// ───────────────────────────── Envío ─────────────────────────────
async function send(s: SocialSettings, recipient: Record<string, string>, message: Record<string, unknown>) {
  const r = await graph<{ message_id?: string }>(`${s.page_id}/messages`, s.page_token!, {}, { method: "POST", body: { recipient, message } });
  return r.message_id ?? null;
}

async function senderAction(s: SocialSettings, id: string, action: "typing_on" | "mark_seen") {
  await graph(`${s.page_id}/messages`, s.page_token!, {}, { method: "POST", body: { recipient: { id }, sender_action: action } }).catch(() => {});
}

// Nombre y usuario de quien escribe (Instagram: username; Messenger: nombre)
async function profile(platform: Platform, id: string, s: SocialSettings) {
  try {
    if (platform === "instagram") {
      const p = await graph<{ name?: string; username?: string }>(id, s.page_token!, { fields: "name,username" });
      return { name: p.name ?? p.username ?? null, username: p.username ?? null };
    }
    const p = await graph<{ first_name?: string; last_name?: string }>(id, s.page_token!, { fields: "first_name,last_name" });
    return { name: [p.first_name, p.last_name].filter(Boolean).join(" ") || null, username: null };
  } catch {
    return { name: null, username: null };
  }
}

async function storeAttachment(contactId: string, mid: string, url: string) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "image/jpeg";
    if (!type.startsWith("image/")) return null;
    const path = `social/${contactId}/${mid.replace(/[^a-zA-Z0-9_-]/g, "").slice(-60)}.${type.includes("png") ? "png" : "jpg"}`;
    const bucket = adminDb().storage.from(PHOTO_BUCKET);
    const up = await bucket.upload(path, Buffer.from(await res.arrayBuffer()), { contentType: type, upsert: true });
    return up.error ? null : bucket.getPublicUrl(path).data.publicUrl;
  } catch {
    return null;
  }
}

// ───────────────────────────── Mensajes directos ─────────────────────────────
async function handleMessage(platform: Platform, m: Messaging, s: SocialSettings) {
  const db = adminDb();
  const msg = m.message;
  const text = msg?.text ?? m.postback?.title ?? null;
  const mid = msg?.mid ?? m.postback?.mid ?? null;
  if (!mid || msg?.is_deleted) return;

  // Mensaje enviado por la cuenta del negocio: si no lo envió el bot, es el equipo → el bot se aparta
  if (msg?.is_echo) {
    const customerId = m.recipient.id;
    await new Promise((r) => setTimeout(r, 3000)); // el bot guarda sus mensajes justo después de enviarlos
    const { data: own } = await db.from("social_messages").select("id").eq("mid", mid).maybeSingle();
    if (own) return;
    await db.from("social_contacts").upsert({ id: customerId, platform }, { onConflict: "id", ignoreDuplicates: true });
    await db.from("social_messages").upsert({ contact_id: customerId, mid, direction: "staff", type: "text", body: text }, { onConflict: "mid", ignoreDuplicates: true });
    await setHuman(customerId);
    return;
  }

  const contactId = m.sender.id;
  const { data: existing } = await db.from("social_contacts").select("*").eq("id", contactId).maybeSingle();
  const who = existing?.username || existing?.name ? { name: existing.name, username: existing.username } : await profile(platform, contactId, s);
  const now = new Date().toISOString();
  await db.from("social_contacts").upsert(
    { id: contactId, platform, name: who.name, username: who.username, last_inbound_at: now },
    { onConflict: "id" }
  );

  // Lead en el CRM
  const customer = await upsertLead({
    name: who.name,
    ...(platform === "instagram" ? { igId: contactId, igUsername: who.username } : { fbPsid: contactId }),
    source: platform,
  }).catch((e) => {
    console.error("CRM:", e);
    return null;
  });
  if (customer) await db.from("social_contacts").update({ customer_id: customer.id }).eq("id", contactId);

  // Foto (para el bot y para el especialista) o adjunto
  const att = msg?.attachments?.[0];
  let type = "text";
  let mediaUrl: string | null = null;
  if (att) {
    type = att.type === "image" ? "image" : att.type;
    if (att.type === "image" && att.payload?.url) mediaUrl = await storeAttachment(contactId, mid, att.payload.url);
    else if (att.payload?.url) mediaUrl = att.payload.url;
  }
  const body = text ?? (msg?.reply_to?.story ? "[Respuesta a una historia]" : null);

  const { data: inserted } = await db
    .from("social_messages")
    .upsert({ contact_id: contactId, mid, direction: "in", type, body, media_url: mediaUrl }, { onConflict: "mid", ignoreDuplicates: true })
    .select("id");
  if (!inserted?.length) return;

  if (s.bot_dm === "off") return;
  await senderAction(s, contactId, "mark_seen");
  await senderAction(s, contactId, "typing_on");
  await new Promise((r) => setTimeout(r, DEBOUNCE_MS));

  const { data: latest } = await db.from("social_messages").select("mid").eq("contact_id", contactId).eq("direction", "in").order("created_at", { ascending: false }).limit(1).single();
  if (latest?.mid !== mid) return;
  const { data: c } = await db.from("social_contacts").select("mode, human_until").eq("id", contactId).single();
  if (c?.mode === "human" && c.human_until && new Date(c.human_until) > new Date()) return;

  await reply(platform, contactId, who, s);
}

async function reply(platform: Platform, contactId: string, who: { name: string | null; username: string | null }, s: SocialSettings) {
  const db = adminDb();
  const { data: rows } = await db
    .from("social_messages")
    .select("direction, type, body, media_url, created_at")
    .eq("contact_id", contactId)
    .gte("created_at", new Date(Date.now() - 14 * 86_400_000).toISOString())
    .order("created_at", { ascending: false })
    .limit(30);
  const history = ((rows ?? []) as HistoryItem[]).reverse();
  const saveOut = (type: string, body: string, mid: string | null, mediaUrl?: string) =>
    db.from("social_messages").insert({ contact_id: contactId, mid, direction: "bot", type, body, media_url: mediaUrl ?? null });
  const lead = (extra: Parameters<typeof upsertLead>[0]) =>
    upsertLead({ ...(platform === "instagram" ? { igId: contactId, igUsername: who.username } : { fbPsid: contactId }), ...extra });
  const where = platform === "instagram" ? `Instagram${who.username ? ` @${who.username}` : ""}` : "Messenger";

  try {
    const text = await runAgent(history, {
      name: who.name,
      now: () => new Date(),
      inventory: getWatches,
      upcomingSlots,
      isBookable,
      takenSlots: async () => {
        const { data } = await db.from("appointments").select("starts_at").in("status", ["requested", "confirmed"]).gte("starts_at", new Date().toISOString());
        return (data ?? []).map((r) => new Date(r.starts_at as string));
      },
      sendImage: async (link, caption) => {
        const mid = await send(s, { id: contactId }, { attachment: { type: "image", payload: { url: link } } });
        await saveOut("image", caption, mid, link);
        const mid2 = await send(s, { id: contactId }, { text: caption });
        await saveOut("text", caption, mid2);
      },
      requestAppointment: async (a) => {
        const customer = await lead({
          name: a.name, email: a.email, source: platform, intent: "buy", stage: "appointment",
          event: { type: "appointment", body: `Solicita cita (${a.kind === "office" ? "oficina" : "videollamada"}) el ${a.date} a las ${a.time}`, meta: { pieces: a.pieces } },
        });
        const startsAt = miamiToUtc(a.date, a.time);
        const { error } = await db.from("appointments").insert({
          kind: a.kind, starts_at: startsAt.toISOString(), name: a.name, email: a.email ?? null, pieces: a.pieces, note: a.note ?? null,
          source: platform, customer_id: customer.id,
        });
        if (error?.code === "23505") return "taken";
        if (error) throw error;
        const when = new Intl.DateTimeFormat("es-ES", { timeZone: TIME_ZONE, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(startsAt);
        await notifyAdmins(`📅 <b>Nueva solicitud de cita · ${h(where)}</b>\n${a.kind === "office" ? "🏛 En la oficina" : "🎥 Videollamada"} · <b>${h(when)}</b>\n${h(a.name)}\n\nConfírmala respondiendo en ${h(where)}.`);
        return "ok";
      },
      submitWatch: async (w) => {
        const { data: photos } = await db.from("social_messages").select("media_url").eq("contact_id", contactId).eq("direction", "in").eq("type", "image")
          .gte("created_at", new Date(Date.now() - 2 * 86_400_000).toISOString()).order("created_at");
        const urls = (photos ?? []).map((p) => p.media_url as string).filter((u) => u?.includes("supabase")).slice(-10);
        const customer = await lead({
          name: w.name, source: platform, intent: w.kind, stage: "qualified",
          event: { type: "sell_request", body: `${{ sell: "Vende", trade: "Intercambia", consign: "Consigna" }[w.kind]}: ${[w.brand, w.model, w.reference].filter(Boolean).join(" ")}` },
        });
        await db.from("sell_requests").insert({
          kind: w.kind, name: w.name, brand: w.brand, model: w.model ?? null, reference: w.reference ?? null, message: w.details ?? null,
          image_paths: urls, customer_id: customer.id,
        });
        await notifyAdmins(`⌚ <b>${{ sell: "Venta", trade: "Intercambio", consign: "Consignación" }[w.kind]} · ${h(where)}</b>\n<b>${h([w.brand, w.model, w.reference].filter(Boolean).join(" "))}</b>\n${h(w.name)}${w.details ? `\n${h(w.details)}` : ""}\n${urls.length} foto(s)`, {}, urls);
        return urls.length;
      },
      handoff: async (reason) => {
        await setHuman(contactId, 24);
        const c = await lead({ source: platform }).catch(() => null);
        if (c) await addEvent(c.id, "handoff", `Pide hablar con una persona: ${reason}`, {}, "bot");
        await notifyAdmins(`👤 <b>${h(where)} · pide una persona</b>\n${h(who.name ?? "Cliente")}\n\n${h(reason)}\n\nResponde desde Instagram o Meta Business Suite: el bot no contestará en este chat durante 24 h.`);
      },
      saveInterest: async ({ query, budget, alert }) => {
        const c = await lead({ source: platform, intent: "buy", stage: "qualified", interests: budget ? `${query} (presupuesto: ${budget})` : query });
        if (alert) await addWatchAlert(c.id, query);
      },
    });
    if (text) {
      // Instagram y Messenger admiten mensajes de hasta 1000 caracteres
      for (const part of text.match(/[\s\S]{1,950}(\s|$)/g) ?? [text]) {
        const mid = await send(s, { id: contactId }, { text: part.trim() });
        await saveOut("text", part.trim(), mid);
      }
    }
  } catch (e) {
    console.error("Error del bot de Meta:", e);
    await setHuman(contactId, 24);
    await notifyAdmins(`⚠️ <b>${h(where)}</b>: el bot no pudo responder a ${h(who.name ?? "un cliente")}. Respóndele tú.`).catch(() => {});
  }
}

async function setHuman(contactId: string, hours = HUMAN_HOURS) {
  await adminDb().from("social_contacts").update({ mode: "human", human_until: new Date(Date.now() + hours * 3_600_000).toISOString() }).eq("id", contactId);
}

export async function reactivateSocialBot(contactId: string) {
  await adminDb().from("social_contacts").update({ mode: "bot", human_until: null }).eq("id", contactId);
}

// ───────────────────────────── Comentarios ─────────────────────────────
type Comment = { id: string; postId: string | null; fromId: string | null; username: string | null; text: string };

const igComment = (v: Record<string, unknown>): Comment => {
  const from = (v.from ?? {}) as { id?: string; username?: string };
  const media = (v.media ?? {}) as { id?: string };
  return { id: String(v.id), postId: media.id ?? null, fromId: from.id ?? null, username: from.username ?? null, text: String(v.text ?? "") };
};
const fbComment = (v: Record<string, unknown>): Comment => {
  const from = (v.from ?? {}) as { id?: string; name?: string };
  return { id: String(v.comment_id), postId: (v.post_id as string) ?? null, fromId: from.id ?? null, username: from.name ?? null, text: String(v.message ?? "") };
};

// Comentarios que muestran interés de compra
const INTEREST = /(precio|price|cu[aá]nto|how much|cost|vale\b|disponible|available|still have|info|informaci[oó]n|interesad|interested|\bdm\b|\bmd\b|inbox|privado|for sale|en venta|lo vend|me interesa|quiero|want it|\$\s?\d)/i;

async function handleComment(platform: Platform, c: Comment, s: SocialSettings) {
  const db = adminDb();
  // Comentarios de la propia cuenta (respuestas del negocio) no son leads
  if (!c.id || !c.text || c.fromId === s.ig_id || c.fromId === s.page_id) return;
  const isLead = INTEREST.test(c.text);
  const { data: inserted } = await db
    .from("social_comments")
    .upsert({ id: c.id, platform, post_id: c.postId, from_id: c.fromId, from_username: c.username, text: c.text, is_lead: isLead }, { onConflict: "id", ignoreDuplicates: true })
    .select("id");
  if (!inserted?.length || !isLead) return;

  const { data: post } = c.postId ? await db.from("social_posts").select("caption, permalink").eq("id", c.postId).maybeSingle() : { data: null };
  const postLabel = post?.caption ? post.caption.split("\n")[0].slice(0, 80) : "una publicación";
  const customer = await upsertLead({
    name: c.username,
    ...(platform === "instagram" ? { igUsername: c.username } : {}),
    source: platform,
    intent: "buy",
    interests: post?.caption ? `Comentó en: ${postLabel}` : null,
    event: { type: "comment", body: `Comentó «${c.text}» en ${postLabel}`, meta: { comment: c.id, post: c.postId, permalink: post?.permalink } },
  }).catch(() => null);
  if (customer) await db.from("social_comments").update({ customer_id: customer.id }).eq("id", c.id);

  // Respuesta privada automática (una sola, en los 7 días siguientes al comentario)
  let replied = false;
  if (s.comment_reply === "on") {
    const text = s.comment_reply_text || DEFAULT_COMMENT_REPLY;
    try {
      await send(s, { comment_id: c.id }, { text });
      await db.from("social_comments").update({ replied_at: new Date().toISOString(), reply_text: text }).eq("id", c.id);
      replied = true;
    } catch (e) {
      console.error("Respuesta privada:", e);
    }
  }

  await notifyAdmins(
    [
      `💬 <b>Comentario con interés · ${platform === "instagram" ? "Instagram" : "Facebook"}</b>`,
      `${c.username ? (platform === "instagram" ? `@${h(c.username)}` : h(c.username)) : "Alguien"}: «${h(c.text)}»`,
      `En: ${h(postLabel)}`,
      post?.permalink ?? "",
      replied ? "✓ Se le respondió por mensaje privado." : "Respóndele desde Instagram.",
    ].filter(Boolean).join("\n")
  ).catch(() => {});
}
