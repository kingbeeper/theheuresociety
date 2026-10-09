import "server-only";
import { revalidateTag } from "next/cache";
import { after } from "next/server";
import { adminDb, PHOTO_BUCKET } from "./supabase";
import { INVENTORY_TAG } from "./inventory";
import { analyzeWatch, type WatchDraft } from "./watch-ai";
import { cutoutConfigured, cutoutPreview, makeCutout } from "./watch-cutout";
import { reactivateBot } from "./wa-bot";
import { addEvent, matchAlerts } from "./crm";
import { downloadFile, escapeHtml as h, keyboard, sendMessage, sendPhoto, tg } from "./telegram";
import { toSlug } from "./watches";

// ───────────────────────── Tipos de Telegram (solo lo que usamos) ─────────────────────────
type TgPhoto = { file_id: string; width: number; height: number };
export type TgMessage = {
  message_id: number;
  chat: { id: number };
  from?: { id: number; first_name?: string };
  text?: string;
  caption?: string;
  photo?: TgPhoto[];
  media_group_id?: string;
};
export type TgCallback = {
  id: string;
  from: { id: number };
  data?: string;
  message?: { message_id: number; chat: { id: number } };
};

type Draft = {
  id: string;
  chat_id: number;
  status: "collecting" | "analyzing" | "ready" | "published" | "cancelled";
  caption: string | null;
  data: WatchDraft | null;
  awaiting: string | null;
};

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://theheuresociety.vercel.app";
const OPEN = ["collecting", "analyzing", "ready"];

const HELP = `<b>The Heure Society · Publicar relojes</b>

1. Envíame las fotos del reloj (de 1 a 10).
2. Escribe una nota con la referencia, el precio y los extras.
   <i>Ej.: Rolex 126610LN, 14500, caja y papeles, excelente estado</i>
3. Revisa la ficha que preparo y pulsa <b>Publicar</b>.
4. Preparo el recorte para el estuche de la web y te lo enseño: pulsa <b>Agregar al estuche</b> si te gusta.

<b>Estuche</b>
Para cambiar el recorte de un reloj ya publicado, envía una foto de frente con el texto <code>estuche</code> y su referencia (ej. <code>estuche 126610LN</code>). Sale mejor sobre una mesa, sin mano.

<b>Órdenes</b>
/lista — últimos relojes publicados
/vista — volver a ver la ficha del borrador actual
/vendido <i>referencia</i> — marcar como vendido
/reservado <i>referencia</i> — marcar como reservado
/disponible <i>referencia</i> — volver a disponible
/estuche <i>referencia</i> — repetir el recorte con sus fotos
/cancelar — descartar el borrador actual`;

// ───────────────────────────── Borradores ─────────────────────────────
async function openDraft(chatId: number): Promise<Draft | null> {
  const { data } = await adminDb().from("bot_drafts").select("*").eq("chat_id", chatId).in("status", OPEN).maybeSingle();
  return data as Draft | null;
}

async function getOrCreateDraft(chatId: number): Promise<Draft> {
  const existing = await openDraft(chatId);
  if (existing) return existing;
  const { data, error } = await adminDb().from("bot_drafts").insert({ chat_id: chatId }).select().single();
  // Si llegan varias fotos a la vez, otra petición pudo crearlo primero (índice único)
  if (error?.code === "23505") return (await openDraft(chatId))!;
  if (error) throw error;
  return data as Draft;
}

async function updateDraft(id: string, fields: Partial<Draft>) {
  const { error } = await adminDb().from("bot_drafts").update({ ...fields, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

async function draftPhotos(draftId: string) {
  const { data } = await adminDb().from("bot_draft_photos").select("url").eq("draft_id", draftId).order("tg_message");
  return (data ?? []).map((p) => p.url as string);
}

// ───────────────────────────── Mensajes ─────────────────────────────
export async function handleMessage(msg: TgMessage) {
  const chatId = msg.chat.id;

  if (msg.photo?.length) return handlePhoto(msg);

  const text = (msg.text ?? "").trim();
  if (!text) return;

  if (text.startsWith("/")) return handleCommand(chatId, text);

  const draft = await openDraft(chatId);

  // Respuesta a "Cambiar precio"
  if (draft?.awaiting === "price" && draft.data) {
    const price = parsePrice(text);
    if (price === undefined) return sendMessage(chatId, "No entendí el precio. Escribe un número (ej. <code>14500</code>) o <code>consultar</code>.");
    await updateDraft(draft.id, { awaiting: null, data: { ...draft.data, price } });
    return sendPreview(chatId, draft.id);
  }

  if (!draft) return sendMessage(chatId, "Primero envíame las fotos del reloj. Escribe /ayuda para ver cómo funciona.");

  const photos = await draftPhotos(draft.id);
  if (!photos.length) return sendMessage(chatId, "Aún no tengo fotos de este reloj. Envíamelas y después la nota.");

  await updateDraft(draft.id, { caption: text });
  return analyze(chatId, draft.id);
}

async function handlePhoto(msg: TgMessage) {
  const chatId = msg.chat.id;
  const best = msg.photo!.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a));

  // «estuche 126610LN»: foto para el recorte de un reloj ya publicado (no abre borrador)
  const forCase = msg.caption?.trim().match(/^\/?estuche\s+(.+)$/i);
  if (forCase) return cutoutFromPhoto(chatId, forCase[1], best.file_id, msg.message_id);

  const draft = await getOrCreateDraft(chatId);
  const db = adminDb();

  // Guardar la foto más grande en Supabase Storage
  const bytes = await downloadFile(best.file_id);
  const path = `drafts/${draft.id}/${msg.message_id}.jpg`;
  const { error: upErr } = await db.storage.from(PHOTO_BUCKET).upload(path, bytes, { contentType: "image/jpeg", upsert: true });
  if (upErr) throw upErr;
  const url = db.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;
  await db.from("bot_draft_photos").upsert({ draft_id: draft.id, path, url, tg_message: msg.message_id }, { onConflict: "draft_id,tg_message", ignoreDuplicates: true });

  // Si ya había una ficha preparada, las fotos nuevas obligan a revisarla de nuevo
  if (draft.status === "ready") await updateDraft(draft.id, { status: "collecting" });

  if (msg.caption?.trim()) {
    await updateDraft(draft.id, { caption: msg.caption.trim() });
    // En un álbum las demás fotos llegan en paralelo: se espera un momento antes de analizar
    if (msg.media_group_id) await new Promise((r) => setTimeout(r, 3500));
    return analyze(chatId, draft.id);
  }

  const photos = await draftPhotos(draft.id);
  if (photos.length === 1 && !draft.caption) {
    await sendMessage(
      chatId,
      "📸 Fotos recibidas. Ahora escríbeme la referencia, el precio y los extras.\n<i>Ej.: Rolex 126610LN, 14500, caja y papeles</i>"
    );
  }
}

async function analyze(chatId: number, draftId: string) {
  const db = adminDb();
  const { data: d } = await db.from("bot_drafts").select("*").eq("id", draftId).single();
  const draft = d as Draft;
  if (draft.status === "analyzing") return; // ya hay un análisis en curso

  await updateDraft(draftId, { status: "analyzing" });
  await tg("sendChatAction", { chat_id: chatId, action: "typing" });
  await sendMessage(chatId, "🔎 Analizando las fotos y preparando la ficha…");

  try {
    const photos = await draftPhotos(draftId);
    const data = await analyzeWatch(photos, draft.caption ?? "");
    await updateDraft(draftId, { status: "ready", data, awaiting: null });
  } catch (e) {
    await updateDraft(draftId, { status: "collecting" });
    await sendMessage(chatId, `⚠️ No pude preparar la ficha: ${h((e as Error).message)}\nPuedes volver a enviar la nota para reintentar.`);
    return;
  }
  // Fuera del try: un fallo al mostrar la vista previa no descarta la ficha ya preparada
  await sendPreview(chatId, draftId);
}

async function sendPreview(chatId: number, draftId: string) {
  const { data: d } = await adminDb().from("bot_drafts").select("*").eq("id", draftId).single();
  const draft = d as Draft;
  const w = draft.data!;
  const photos = await draftPhotos(draftId);

  const price = w.price == null ? "Precio a consultar" : `${w.currency} ${w.price.toLocaleString("en-US")}`;
  const set = [w.hasBox && "caja", w.hasPapers && "papeles"].filter(Boolean).join(" y ") || "solo reloj";
  const specs = [
    `Caja: ${w.caseSize} · ${w.material.es}`,
    w.dial && `Esfera: ${w.dial.es}`,
    w.bracelet && `Brazalete: ${w.bracelet.es}`,
    w.movement && `Movimiento: ${w.movement}${w.powerReserve ? ` · ${w.powerReserve}` : ""}`,
    w.waterResistance && `Hermeticidad: ${w.waterResistance}`,
  ].filter(Boolean) as string[];

  const caption = [
    `<b>${h(w.brand)} ${h(w.model)}</b>`,
    `Ref. ${h(w.reference)}${w.year ? ` · ${w.year}` : ""}`,
    `<b>${h(price)}</b> · ${set}`,
    "",
    ...specs.map(h),
  ].join("\n");
  // Si la foto no se puede enviar, la ficha llega igual (no se pierde el trabajo de la IA)
  const photoSent = await sendPhoto(chatId, photos[0], caption.slice(0, 1024)).then(
    () => true,
    (e) => {
      console.error("Vista previa sin foto:", e);
      return false;
    }
  );

  const warnings = w.warnings.length
    ? `\n\n⚠️ <b>Revisar</b> (confianza ${w.confidence === "high" ? "alta" : w.confidence === "medium" ? "media" : "baja"}):\n${w.warnings.map((x) => `• ${h(x)}`).join("\n")}`
    : "";

  await sendMessage(
    chatId,
    `${photoSent ? "" : `${caption}\n\n`}<b>ES</b> ${h(w.description.es)}\n\n<b>EN</b> ${h(w.description.en)}\n\n📷 ${photos.length} foto(s)${warnings}`,
    {
      reply_markup: keyboard([
        [{ text: "✅ Publicar", callback_data: `pub:${draftId}` }],
        [
          { text: "💲 Cambiar precio", callback_data: `price:${draftId}` },
          { text: "❌ Cancelar", callback_data: `cancel:${draftId}` },
        ],
      ]),
    }
  );
}

// ───────────────────────────── Botones ─────────────────────────────
export async function handleCallback(cb: TgCallback) {
  const chatId = cb.message?.chat.id;
  const [action, draftId] = (cb.data ?? "").split(":");
  if (!chatId || !draftId) return tg("answerCallbackQuery", { callback_query_id: cb.id });

  // Aviso de WhatsApp: el equipo devuelve la conversación al bot
  if (action === "wabot") {
    await reactivateBot(draftId);
    await tg("answerCallbackQuery", { callback_query_id: cb.id, text: "El bot vuelve a responder en ese chat" });
    return tg("editMessageReplyMarkup", { chat_id: chatId, message_id: cb.message!.message_id, reply_markup: keyboard([]) }).catch(() => {});
  }

  // Botones del recorte del estuche: llevan el id del reloj publicado, no de un borrador
  if (["cutok", "cutno", "cutredo", "cutdel"].includes(action)) return handleCutoutButton(cb, chatId, action, draftId);

  const { data: d } = await adminDb().from("bot_drafts").select("*").eq("id", draftId).maybeSingle();
  const draft = d as Draft | null;
  const removeButtons = () =>
    tg("editMessageReplyMarkup", { chat_id: chatId, message_id: cb.message!.message_id, reply_markup: keyboard([]) }).catch(() => {});

  if (!draft || !OPEN.includes(draft.status)) {
    await tg("answerCallbackQuery", { callback_query_id: cb.id, text: "Este borrador ya no está activo." });
    return removeButtons();
  }

  if (action === "pub") {
    await tg("answerCallbackQuery", { callback_query_id: cb.id, text: "Publicando…" });
    await removeButtons();
    const { slug, id } = await publish(draft);
    await sendMessage(chatId, `✅ <b>Publicado.</b> Ya está en la colección:\n${SITE_URL}/es/watches/${slug}`);
    // El recorte tarda un poco: se prepara después de responder a Telegram
    after(() => cutoutJob(chatId, id));
    // Compradores que esperaban una pieza así (búsquedas «avísenme» del CRM)
    after(() => notifyAlertMatches(chatId, draft.data!, slug).catch((e) => console.error("Avisos:", e)));
    return;
  }

  if (action === "price") {
    await updateDraft(draft.id, { awaiting: "price" });
    await tg("answerCallbackQuery", { callback_query_id: cb.id });
    return sendMessage(chatId, "Escribe el nuevo precio (ej. <code>14500</code>) o <code>consultar</code> para mostrar «Precio a consultar».");
  }

  if (action === "cancel") {
    await updateDraft(draft.id, { status: "cancelled", awaiting: null });
    await tg("answerCallbackQuery", { callback_query_id: cb.id, text: "Borrador descartado" });
    await removeButtons();
    return sendMessage(chatId, "Borrador descartado. Envíame fotos cuando quieras publicar otro reloj.");
  }

  return tg("answerCallbackQuery", { callback_query_id: cb.id });
}

async function publish(draft: Draft) {
  const db = adminDb();
  const w = draft.data!;
  const images = await draftPhotos(draft.id);

  // Slug único: si ya existe (otra pieza igual), se añade un número
  const base = toSlug(w.brand, w.model, w.reference);
  const { data: taken } = await db.from("watches").select("slug").like("slug", `${base}%`);
  const used = new Set((taken ?? []).map((r) => r.slug as string));
  let slug = base;
  for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`;

  // Fotos con nombre descriptivo (rolex-land-dweller-127334-1.jpg) en vez de drafts/…/28.jpg:
  // ayuda a salir en Google Imágenes. Se copian (el borrador conserva las suyas por si la
  // publicación fallara); si alguna no se puede copiar, se usa la original.
  const bucket = db.storage.from(PHOTO_BUCKET);
  for (const [i, url] of images.entries()) {
    const from = url.split(`/object/public/${PHOTO_BUCKET}/`)[1];
    const to = `watches/${slug}-${i + 1}.jpg`;
    if (from && !(await bucket.copy(from, to)).error) images[i] = bucket.getPublicUrl(to).data.publicUrl;
  }

  const now = new Date().toISOString();
  const { data: row, error } = await db
    .from("watches")
    .insert({
      slug,
      status: "available",
      brand: w.brand,
      model: w.model,
      reference: w.reference,
      year: w.year,
      has_box: w.hasBox,
      has_papers: w.hasPapers,
      price: w.price,
      currency: w.currency,
      case_size: w.caseSize,
      material: w.material,
      dial: w.dial,
      bracelet: w.bracelet,
      description: w.description,
      movement: w.movement,
      power_reserve: w.powerReserve,
      water_resistance: w.waterResistance,
      images,
      source: "telegram",
      published_at: now,
    })
    .select("id")
    .single();
  if (error) throw error;

  await updateDraft(draft.id, { status: "published", watch_id: row.id } as Partial<Draft>);

  // Entra también en el inventario del CRM (el costo y el proveedor se completan allí)
  const { data: stock } = await db
    .from("inventory_items")
    .insert({
      acquisition: "purchase", brand: w.brand, model: w.model, reference: w.reference,
      comes_with: [w.hasBox && "Box", w.hasPapers && "Papers"].filter(Boolean).join(", ") || null,
      condition: "Pre-Owned", purchase_date: now.slice(0, 10), asking_price: w.price, watch_id: row.id,
    })
    .select("id")
    .single();
  if (stock) await adminDb().from("inventory_events").insert({ item_id: stock.id, type: "entry", body: "Entrada desde Telegram (publicado en la web). Falta el costo.", created_by: "bot" });
  revalidateTag(INVENTORY_TAG, { expire: 0 });
  return { slug, id: row.id as string };
}

// ───────────────────────────── Avisos a compradores ─────────────────────────────
async function notifyAlertMatches(chatId: number, w: WatchDraft, slug: string) {
  const matches = await matchAlerts({ brand: w.brand, model: w.model, reference: w.reference });
  if (!matches.length) return;
  const lines = matches.map((a) => {
    const c = a.customer;
    const wa = c?.wa_id ?? c?.phone?.replace(/\D/g, "");
    return [`• <b>${h(c?.name ?? "Cliente")}</b>${c?.phone ? ` · ${c.phone}` : ""}`, `  Busca: «${h(a.query)}»`, wa ? `  https://wa.me/${wa}` : ""]
      .filter(Boolean)
      .join("\n");
  });
  await sendMessage(
    chatId,
    [
      `🔔 <b>${matches.length} cliente(s) esperaban una pieza así</b>`,
      `${h(w.brand)} ${h(w.model)} (${h(w.reference)})`,
      `${SITE_URL}/es/watches/${slug}`,
      "",
      lines.join("\n\n"),
      "",
      "Escríbeles antes de que se publique en redes.",
    ].join("\n")
  );
  const now = new Date().toISOString();
  for (const a of matches) {
    await adminDb().from("watch_alerts").update({ last_notified_at: now }).eq("id", a.id);
    if (a.customer) await addEvent(a.customer.id, "match", `Llegó una pieza que encaja: ${w.brand} ${w.model} ${w.reference}`, { slug });
  }
}

// ───────────────────────────── Recorte para el estuche ─────────────────────────────
type PublishedWatch = { id: string; slug: string; brand: string; model: string; reference: string; case_size: string; images: string[] };
const PUBLISHED_FIELDS = "id, slug, brand, model, reference, case_size, images";

// Busca un reloj publicado por referencia o slug. Devuelve el reloj o un mensaje para el usuario.
async function findPublished(arg: string): Promise<PublishedWatch | string> {
  const { data } = await adminDb()
    .from("watches")
    .select(PUBLISHED_FIELDS)
    .in("status", ["available", "reserved", "sold"])
    .or(`reference.ilike.%${arg.replace(/[,()%]/g, "")}%,slug.ilike.%${toSlug(arg)}%`);
  if (!data?.length) return `No encontré ningún reloj publicado con «${h(arg)}».`;
  if (data.length > 1) return `Hay ${data.length} relojes que coinciden. Sé más específico:\n${data.map((r) => `• <code>${h(r.slug)}</code>`).join("\n")}`;
  return data[0] as PublishedWatch;
}

const storagePath = (url: string) => url.split(`/object/public/${PHOTO_BUCKET}/`)[1];

// Recorte pendiente de aprobar: uno por reloj, se sustituye al repetir
const pendingPath = (watchId: string) => `cutouts/pending/${watchId}.png`;

// Prepara el recorte (con las fotos indicadas o con las del reloj) y envía la vista previa.
// No entra en el estuche hasta que el administrador pulsa «Agregar al estuche».
async function cutoutJob(chatId: number, watchId: string, photos?: string[]) {
  const db = adminDb();
  const { data } = await db.from("watches").select(PUBLISHED_FIELDS).eq("id", watchId).single();
  const w = data as PublishedWatch;
  const name = `${h(w.brand)} ${h(w.model)}`;
  const retry = `Envíame una foto del reloj de frente, mejor sobre una mesa y sin mano, con el texto <code>estuche ${h(w.reference)}</code>.`;

  if (!cutoutConfigured) {
    return sendMessage(chatId, `ℹ️ El recorte automático para el estuche aún no está activado, así que ${name} sale en la colección pero no en el estuche.`);
  }

  try {
    // Tarda alrededor de un minuto: se avisa para que no parezca que el robot se quedó parado
    await sendMessage(chatId, `✂️ Preparando el recorte de ${name} para el estuche y generando la vista previa… Tarda alrededor de un minuto.`);
    await tg("sendChatAction", { chat_id: chatId, action: "upload_photo" });
    const result = await makeCutout(photos ?? w.images, w.case_size);
    if (!result.ok) {
      return sendMessage(chatId, `✂️ <b>${name}</b>: no pude hacer el recorte para el estuche. ${h(result.reason)}

${retry}
Mientras tanto sale en la colección, pero no en el estuche.`);
    }

    const bucket = db.storage.from(PHOTO_BUCKET);
    // La vista previa lleva un nombre nuevo cada vez, para que Telegram no muestre una anterior
    const previewPath = `cutouts/preview/${w.slug}-${Date.now()}.jpg`;
    const up1 = await bucket.upload(pendingPath(w.id), result.png, { contentType: "image/png", upsert: true });
    const up2 = await bucket.upload(previewPath, await cutoutPreview(result.png), { contentType: "image/jpeg", upsert: true });
    if (up1.error || up2.error) throw up1.error ?? up2.error;

    await sendPhoto(chatId, bucket.getPublicUrl(previewPath).data.publicUrl, `✂️ Vista previa de <b>${name}</b> para el estuche.
¿Lo agrego? Si el recorte no está bien, repítelo o descártalo. ${retry}`, {
      reply_markup: keyboard([
        [{ text: "✅ Agregar al estuche", callback_data: `cutok:${w.id}` }],
        [
          { text: "🔁 Repetir", callback_data: `cutredo:${w.id}` },
          { text: "✖️ Descartar", callback_data: `cutno:${w.id}` },
        ],
      ]),
    });
  } catch (e) {
    console.error("Error en el recorte:", e);
    await sendMessage(chatId, `⚠️ <b>${name}</b>: falló el recorte para el estuche (${h((e as Error).message)}).
${retry}`);
  }
}

// «Agregar al estuche»: el recorte pendiente pasa a ser el del reloj y la web se actualiza
async function acceptCutout(watchId: string) {
  const db = adminDb();
  const bucket = db.storage.from(PHOTO_BUCKET);
  const { data } = await db.from("watches").select("slug, brand, model, cutout").eq("id", watchId).single();
  if (!data) return { ok: false as const, text: "Este reloj ya no existe." };

  // Nombre nuevo en cada versión, para que nadie vea un recorte anterior guardado en caché
  const path = `cutouts/${data.slug}-${Date.now()}.png`;
  const { error: moveErr } = await bucket.move(pendingPath(watchId), path);
  if (moveErr) return { ok: false as const, text: "Esta vista previa ya no está disponible. Pulsa Repetir o usa /estuche." };

  const { error } = await db.from("watches").update({ cutout: bucket.getPublicUrl(path).data.publicUrl, updated_at: new Date().toISOString() }).eq("id", watchId);
  if (error) throw error;
  // El recorte anterior ya no se usa
  if (data.cutout && storagePath(data.cutout)) await bucket.remove([storagePath(data.cutout)]);
  revalidateTag(INVENTORY_TAG, { expire: 0 });
  return { ok: true as const, text: `✅ <b>${h(data.brand)} ${h(data.model)}</b> ya está en el estuche.` };
}

// Foto enviada con «estuche referencia»: se guarda y se usa solo para el recorte
async function cutoutFromPhoto(chatId: number, ref: string, fileId: string, messageId: number) {
  const found = await findPublished(ref);
  if (typeof found === "string") return sendMessage(chatId, found);
  const db = adminDb();
  const path = `cutouts/sources/${found.slug}-${messageId}.jpg`;
  const { error } = await db.storage.from(PHOTO_BUCKET).upload(path, await downloadFile(fileId), { contentType: "image/jpeg", upsert: true });
  if (error) throw error;
  return cutoutJob(chatId, found.id, [db.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl]);
}

async function handleCutoutButton(cb: TgCallback, chatId: number, action: string, watchId: string) {
  const removeButtons = () =>
    tg("editMessageReplyMarkup", { chat_id: chatId, message_id: cb.message!.message_id, reply_markup: keyboard([]) }).catch(() => {});
  const db = adminDb();

  if (action === "cutredo") {
    await tg("answerCallbackQuery", { callback_query_id: cb.id, text: "Repitiendo el recorte…" });
    await removeButtons();
    after(() => cutoutJob(chatId, watchId));
    return;
  }

  if (action === "cutok") {
    await tg("answerCallbackQuery", { callback_query_id: cb.id, text: "Agregando al estuche…" });
    await removeButtons();
    const result = await acceptCutout(watchId);
    return sendMessage(chatId, result.text, result.ok ? { reply_markup: keyboard([[{ text: "🗑 Quitar del estuche", callback_data: `cutdel:${watchId}` }]]) } : {});
  }

  if (action === "cutno") {
    await db.storage.from(PHOTO_BUCKET).remove([pendingPath(watchId)]);
    await tg("answerCallbackQuery", { callback_query_id: cb.id, text: "Recorte descartado" });
    await removeButtons();
    return sendMessage(chatId, "Recorte descartado: el estuche queda como estaba. Para intentarlo con otra foto, envíala con el texto <code>estuche</code> y la referencia.");
  }

  // cutdel: quitar del estuche el recorte ya aprobado
  const { data } = await db.from("watches").select("cutout, brand, model").eq("id", watchId).single();
  await db.from("watches").update({ cutout: null, updated_at: new Date().toISOString() }).eq("id", watchId);
  if (data?.cutout && storagePath(data.cutout)) await db.storage.from(PHOTO_BUCKET).remove([storagePath(data.cutout)]);
  revalidateTag(INVENTORY_TAG, { expire: 0 });
  await tg("answerCallbackQuery", { callback_query_id: cb.id, text: "Quitado del estuche" });
  await removeButtons();
  return sendMessage(chatId, `${h(data?.brand ?? "")} ${h(data?.model ?? "")} ya no sale en el estuche (sigue en la colección). Para volver a ponerlo, envía una foto con el texto <code>estuche</code> y su referencia.`);
}

// ───────────────────────────── Órdenes ─────────────────────────────
async function handleCommand(chatId: number, text: string) {
  const [cmd, ...rest] = text.split(/\s+/);
  const arg = rest.join(" ").trim();
  const command = cmd.toLowerCase().replace(/@.*$/, "");

  switch (command) {
    case "/start":
    case "/ayuda":
    case "/help":
      return sendMessage(chatId, HELP);

    case "/vista": {
      // Reenvía la ficha ya preparada (sin volver a llamar a la IA)
      const draft = await openDraft(chatId);
      if (!draft?.data) return sendMessage(chatId, "No hay ninguna ficha preparada. Envíame fotos y la nota del reloj.");
      if (draft.status !== "ready") await updateDraft(draft.id, { status: "ready" });
      return sendPreview(chatId, draft.id);
    }

    case "/cancelar": {
      const draft = await openDraft(chatId);
      if (draft) await updateDraft(draft.id, { status: "cancelled", awaiting: null });
      return sendMessage(chatId, draft ? "Borrador descartado." : "No hay ningún borrador abierto.");
    }

    case "/lista": {
      const { data } = await adminDb()
        .from("watches")
        .select("brand, model, reference, status, price, currency")
        .in("status", ["available", "reserved", "sold"])
        .order("published_at", { ascending: false })
        .limit(15);
      if (!data?.length) return sendMessage(chatId, "Todavía no hay relojes publicados.");
      const icon = { available: "🟢", reserved: "🟡", sold: "⚫" } as Record<string, string>;
      const lines = data.map(
        (r) => `${icon[r.status]} ${h(r.brand)} ${h(r.model)} · <code>${h(r.reference)}</code>${r.price ? ` · ${r.currency} ${Number(r.price).toLocaleString("en-US")}` : ""}`
      );
      return sendMessage(chatId, `<b>Últimos publicados</b>\n🟢 disponible · 🟡 reservado · ⚫ vendido\n\n${lines.join("\n")}`);
    }

    case "/vendido":
    case "/reservado":
    case "/disponible": {
      const status = { "/vendido": "sold", "/reservado": "reserved", "/disponible": "available" }[command]!;
      if (!arg) return sendMessage(chatId, `Indica la referencia. Ej.: <code>${command} 126610LN</code>`);
      const found = await findPublished(arg);
      if (typeof found === "string") return sendMessage(chatId, found);
      await adminDb().from("watches").update({ status, updated_at: new Date().toISOString() }).eq("id", found.id);
      // El inventario sigue el mismo estado (en una venta, el precio y el comprador se completan en el CRM)
      const { data: stockItem } = await adminDb().from("inventory_items").select("id, status").eq("watch_id", found.id).in("status", ["in_stock", "reserved", "sold"]).maybeSingle();
      if (stockItem && stockItem.status !== "sold") {
        const next = status === "sold" ? "sold" : status === "reserved" ? "reserved" : "in_stock";
        await adminDb().from("inventory_items")
          .update({ status: next, ...(next === "sold" && { sale_date: new Date().toISOString().slice(0, 10) }), updated_at: new Date().toISOString() })
          .eq("id", stockItem.id);
        await adminDb().from("inventory_events").insert({ item_id: stockItem.id, type: next === "sold" ? "sale" : "status", body: `${command} desde Telegram`, created_by: "bot" });
        if (next === "sold") {
          await sendMessage(chatId, `Completa el precio de venta y el comprador en el CRM:\n${SITE_URL}/admin/inventario/${stockItem.id}`);
        }
      }
      revalidateTag(INVENTORY_TAG, { expire: 0 });
      const label = { sold: "vendido", reserved: "reservado", available: "disponible" }[status];
      return sendMessage(chatId, `Hecho: ${h(found.brand)} ${h(found.model)} (${h(found.reference)}) ahora figura como <b>${label}</b>.`);
    }

    case "/estuche": {
      if (!arg) return sendMessage(chatId, "Indica la referencia. Ej.: <code>/estuche 126610LN</code>\nO envía una foto con el texto <code>estuche 126610LN</code>.");
      const found = await findPublished(arg);
      if (typeof found === "string") return sendMessage(chatId, found);
      after(() => cutoutJob(chatId, found.id));
      return;
    }

    default:
      return sendMessage(chatId, "No conozco esa orden. Escribe /ayuda para ver las opciones.");
  }
}

// "14500", "14.500", "14,500", "14.5k", "$14,500" -> 14500 · "consultar" -> null · otra cosa -> undefined
function parsePrice(text: string): number | null | undefined {
  const t = text.toLowerCase().trim();
  if (/consult|request|n\/a/.test(t)) return null;
  const k = /k\b/.test(t);
  const digits = t.replace(/[^\d.,]/g, "");
  if (!digits) return undefined;
  const normalized = k ? digits.replace(",", ".") : digits.replace(/[.,](?=\d{3}\b)/g, "").replace(",", ".");
  const n = Number(normalized) * (k ? 1000 : 1);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
}
