import "server-only";
import { adminDb, PHOTO_BUCKET } from "./supabase";
import { getWatches } from "./inventory";
import { isBookable, miamiToUtc, upcomingSlots, TIME_ZONE } from "./booking";
import { downloadMedia, markReadTyping, sendImage, sendText } from "./whatsapp";
import { runAgent, type HistoryItem } from "./wa-agent";
import { escapeHtml as h, keyboard, notifyAdmins } from "./telegram";

// Lógica del chatbot de WhatsApp: guarda cada mensaje, decide si el bot responde y ejecuta
// lo que pide el agente (citas, relojes para vender, pasar con una persona).

// Cuánto se calla el bot cuando alguien del equipo escribe o se le pasa la conversación
const HUMAN_HOURS = 12;
// Espera antes de responder: si el cliente manda varios mensajes o fotos seguidos, se contestan juntos
const DEBOUNCE_MS = 4000;

type WaMessage = {
  id: string;
  from: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  image?: { id: string; caption?: string; mime_type?: string };
  document?: { id: string; caption?: string; filename?: string; mime_type?: string };
  video?: { id: string; caption?: string };
  audio?: { id: string };
  interactive?: { button_reply?: { title: string }; list_reply?: { title: string } };
  button?: { text: string };
  location?: { latitude: number; longitude: number; name?: string };
};
type WaEcho = { id: string; from: string; to: string; type: string; text?: { body: string }; image?: { caption?: string } };
type WaValue = {
  contacts?: { wa_id: string; profile?: { name?: string } }[];
  messages?: WaMessage[];
  message_echoes?: WaEcho[];
};
export type WaWebhook = { entry?: { changes?: { field: string; value: WaValue }[] }[] };

const waLink = (waId: string) => `https://wa.me/${waId}`;
const reactivateButton = (waId: string) => keyboard([[{ text: "🤖 Reactivar el bot en este chat", callback_data: `wabot:${waId}` }]]);

// ───────────────────────────── Entrada ─────────────────────────────
export async function handleWebhook(payload: WaWebhook) {
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const v = change.value;
      if (change.field === "smb_message_echoes") {
        for (const echo of v.message_echoes ?? []) await handleStaffEcho(echo);
      } else if (change.field === "messages") {
        const names = new Map((v.contacts ?? []).map((c) => [c.wa_id, c.profile?.name ?? null]));
        for (const m of v.messages ?? []) await handleInbound(m, names.get(m.from) ?? null);
      }
    }
  }
}

// Mensaje escrito por el equipo desde la app WhatsApp Business: el bot se aparta de ese chat
async function handleStaffEcho(echo: WaEcho) {
  const db = adminDb();
  await db.from("wa_contacts").upsert({ wa_id: echo.to }, { onConflict: "wa_id", ignoreDuplicates: true });
  await db.from("wa_messages").upsert(
    { wa_id: echo.to, wamid: echo.id, direction: "staff", type: echo.type, body: echo.text?.body ?? echo.image?.caption ?? null },
    { onConflict: "wamid", ignoreDuplicates: true }
  );
  await setHuman(echo.to);
}

async function handleInbound(m: WaMessage, profileName: string | null) {
  const db = adminDb();
  const now = new Date().toISOString();
  const { data: existing } = await db.from("wa_contacts").select("name").eq("wa_id", m.from).maybeSingle();
  await db.from("wa_contacts").upsert(
    { wa_id: m.from, name: existing?.name ?? profileName, last_inbound_at: now, updated_at: now },
    { onConflict: "wa_id" }
  );

  // Texto y archivo (las fotos se guardan para el bot y para el especialista)
  let body: string | null = m.text?.body ?? m.image?.caption ?? m.document?.caption ?? m.video?.caption ?? null;
  body ??= m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? m.button?.text ?? null;
  if (m.location) body = `Ubicación: ${m.location.name ?? ""} ${m.location.latitude},${m.location.longitude}`.trim();
  let mediaUrl: string | null = null;
  const media = m.image ?? m.document;
  if (media) {
    try {
      const { bytes, mimeType } = await downloadMedia(media.id);
      const ext = mimeType.includes("png") ? "png" : mimeType.includes("pdf") ? "pdf" : "jpg";
      const path = `wa/${m.from}/${m.id.replace(/[^a-zA-Z0-9_-]/g, "")}.${ext}`;
      const bucket = db.storage.from(PHOTO_BUCKET);
      const up = await bucket.upload(path, bytes, { contentType: mimeType, upsert: true });
      if (!up.error) mediaUrl = bucket.getPublicUrl(path).data.publicUrl;
    } catch (e) {
      console.error("No se pudo guardar el archivo de WhatsApp:", e);
    }
  }

  // Si WhatsApp reenvía el mismo mensaje, no se procesa dos veces
  const { data: inserted } = await db
    .from("wa_messages")
    .upsert({ wa_id: m.from, wamid: m.id, direction: "in", type: m.type, body, media_url: mediaUrl }, { onConflict: "wamid", ignoreDuplicates: true })
    .select("id");
  if (!inserted?.length) return;
  if (m.type === "reaction" || m.type === "sticker") return;

  await markReadTyping(m.id);
  await new Promise((r) => setTimeout(r, DEBOUNCE_MS));

  // Solo responde la última llamada (los mensajes anteriores ya van en el historial)
  const { data: latest } = await db.from("wa_messages").select("wamid").eq("wa_id", m.from).eq("direction", "in").order("created_at", { ascending: false }).limit(1).single();
  if (latest?.wamid !== m.id) return;

  const { data: c } = await db.from("wa_contacts").select("name, mode, human_until").eq("wa_id", m.from).single();
  if (c?.mode === "human" && c.human_until && new Date(c.human_until) > new Date()) return;

  await reply(m.from, c?.name ?? profileName);
}

// ───────────────────────────── Respuesta del bot ─────────────────────────────
async function reply(waId: string, name: string | null) {
  const db = adminDb();
  const { data: rows } = await db
    .from("wa_messages")
    .select("direction, type, body, media_url, created_at")
    .eq("wa_id", waId)
    .gte("created_at", new Date(Date.now() - 14 * 86_400_000).toISOString())
    .order("created_at", { ascending: false })
    .limit(30);
  const history = ((rows ?? []) as HistoryItem[]).reverse();

  const saveOut = async (type: string, body: string, wamid?: string, mediaUrl?: string) => {
    await db.from("wa_messages").insert({ wa_id: waId, wamid: wamid || null, direction: "bot", type, body, media_url: mediaUrl ?? null });
  };

  try {
    const text = await runAgent(history, {
      name,
      now: () => new Date(),
      inventory: getWatches,
      upcomingSlots,
      isBookable,
      takenSlots: async () => {
        const { data } = await db.from("appointments").select("starts_at").in("status", ["requested", "confirmed"]).gte("starts_at", new Date().toISOString());
        return (data ?? []).map((r) => new Date(r.starts_at as string));
      },
      sendImage: async (link, caption) => {
        const id = await sendImage(waId, link, caption);
        await saveOut("image", caption, id, link);
      },
      requestAppointment: (a) => requestAppointment(waId, a),
      submitWatch: (s) => submitWatch(waId, s),
      handoff: (reason) => handoff(waId, name, reason),
    });
    if (text) {
      const ids = await sendText(waId, text);
      await saveOut("text", text, ids[0]);
    }
  } catch (e) {
    console.error("Error del bot de WhatsApp:", e);
    const sorry = "Disculpe, ahora mismo no puedo responder. Una persona del equipo le escribirá en breve. / Sorry, I can't reply right now — someone from our team will message you shortly.";
    await sendText(waId, sorry).catch(() => {});
    await handoff(waId, name, `El bot falló (${(e as Error).message.slice(0, 120)})`);
  }
}

// ───────────────────────────── Acciones ─────────────────────────────
async function setHuman(waId: string, hours = HUMAN_HOURS) {
  await adminDb()
    .from("wa_contacts")
    .update({ mode: "human", human_until: new Date(Date.now() + hours * 3_600_000).toISOString(), updated_at: new Date().toISOString() })
    .eq("wa_id", waId);
}

async function handoff(waId: string, name: string | null, reason: string) {
  await setHuman(waId, 24);
  await notifyAdmins(
    `👤 <b>WhatsApp · pide una persona</b>\n${h(name ?? "Cliente")} · +${waId}\n\n${h(reason)}\n\nResponde desde la app WhatsApp Business: el bot no contestará en este chat durante 24 h.\n${waLink(waId)}`,
    { reply_markup: reactivateButton(waId) }
  );
}

async function requestAppointment(
  waId: string,
  a: { kind: "office" | "video"; date: string; time: string; name: string; email?: string; pieces: string[]; note?: string }
): Promise<"ok" | "taken"> {
  const startsAt = miamiToUtc(a.date, a.time);
  const { error } = await adminDb().from("appointments").insert({
    kind: a.kind, starts_at: startsAt.toISOString(), name: a.name, phone: `+${waId}`, email: a.email ?? null, pieces: a.pieces, note: a.note ?? null,
  });
  if (error?.code === "23505") return "taken";
  if (error) throw error;
  await adminDb().from("wa_contacts").update({ name: a.name }).eq("wa_id", waId);

  const when = new Intl.DateTimeFormat("es-ES", { timeZone: TIME_ZONE, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(startsAt);
  const watches = a.pieces.length ? (await getWatches()).filter((w) => a.pieces.includes(w.slug)).map((w) => `${w.brand} ${w.model} (${w.reference})`) : [];
  await notifyAdmins(
    [
      `📅 <b>Nueva solicitud de cita · WhatsApp</b>`,
      `${a.kind === "office" ? "🏛 En la oficina" : "🎥 Videollamada"} · <b>${h(when)}</b>`,
      `${h(a.name)} · +${waId}${a.email ? ` · ${h(a.email)}` : ""}`,
      watches.length ? `Quiere ver: ${h(watches.join(", "))}` : "",
      a.note ? `Nota: ${h(a.note)}` : "",
      "",
      `Confírmala respondiendo en WhatsApp: ${waLink(waId)}`,
    ].filter(Boolean).join("\n")
  );
  return "ok";
}

async function submitWatch(waId: string, s: { kind: "sell" | "trade" | "consign"; name: string; brand: string; model?: string; reference?: string; details?: string }) {
  const db = adminDb();
  const { data: photos } = await db
    .from("wa_messages")
    .select("media_url")
    .eq("wa_id", waId)
    .eq("direction", "in")
    .eq("type", "image")
    .gte("created_at", new Date(Date.now() - 2 * 86_400_000).toISOString())
    .order("created_at", { ascending: true });
  const urls = (photos ?? []).map((p) => p.media_url as string).filter(Boolean).slice(-10);
  await db.from("sell_requests").insert({
    kind: s.kind, name: s.name, phone: `+${waId}`, brand: s.brand, model: s.model ?? null, reference: s.reference ?? null,
    message: s.details ?? null, image_paths: urls,
  });
  const label = { sell: "Venta", trade: "Intercambio", consign: "Consignación" }[s.kind];
  await notifyAdmins(
    [
      `⌚ <b>${label} · WhatsApp</b>`,
      `<b>${h([s.brand, s.model, s.reference && `(${s.reference})`].filter(Boolean).join(" "))}</b>`,
      `${h(s.name)} · +${waId}`,
      s.details ? h(s.details) : "",
      `${urls.length} foto(s)`,
      "",
      `Responde con la oferta en WhatsApp: ${waLink(waId)}`,
    ].filter(Boolean).join("\n"),
    {},
    urls
  );
  return urls.length;
}

// Botón «Reactivar el bot» del aviso de Telegram
export async function reactivateBot(waId: string) {
  await adminDb().from("wa_contacts").update({ mode: "bot", human_until: null, updated_at: new Date().toISOString() }).eq("wa_id", waId);
}
