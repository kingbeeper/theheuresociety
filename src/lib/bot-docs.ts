import "server-only";
import { after } from "next/server";
import { adminDb } from "./supabase";
import { normalizePhone, upsertLead } from "./crm";
import { createStockItem, returnToOwner, type Item } from "./stock";
import { PAYMENT } from "./stock-labels";
import { todayInMiami } from "./booking";
import { closeReturned, consignorPaid, getDoc, getDocSettings, insertDoc, issueDoc, payInvoice, toInvoice } from "./documents";
import { pdfName, renderDocPdf } from "./doc-pdf";
import { KIND_LABEL, docTotals, termsFor, usd, type Doc, type DocKind } from "./doc-labels";
import { escapeHtml as h, keyboard, sendDocumentFile, sendMessage, tg, type InlineButton } from "./telegram";
import { analyze, cutoutJob, draftWatch, notifyAlertMatches, parsePrice, publish, updateDraft } from "./bot";
import type { WatchDraft } from "./watch-ai";

// Documentos desde Telegram: /factura, /memo, /consignacion, /cotizacion y /compra.
// El robot pregunta lo que falta (reloj, cliente, precio) y al final crea el documento, lo
// envía en PDF con el enlace para el cliente, y lo deja enlazado al inventario y al CRM.
// Si el reloj no está en el inventario, se envían fotos: la IA prepara la ficha y se da de alta
// (y en consignaciones y compras, se publica en la web).

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://theheuresociety.vercel.app";

type FlowKind = DocKind | "purchase";
type Step = "watch" | "photos" | "client" | "price" | "asking" | "confirm";
type StockPick = { id: string; sku: string; title: string; details: string; serial: string | null; price: number | null; cost: number | null; ownerId: string | null; ownerName: string | null };

export type DocFlow = {
  kind: FlowKind;
  step: Step;
  user: string;
  item?: StockPick; // reloj del inventario
  draftId?: string; // reloj nuevo (fotos → ficha de la IA)
  watch?: { title: string; details: string; suggested: number | null };
  customerId?: string | null;
  client?: { name: string | null; phone: string | null; email: string | null };
  price?: number;
  asking?: number | null; // precio en la web (consignación y compra); null = no publicar
  lang: "en" | "es";
  tax: number;
  notes?: string;
};

export const FLOW_COMMANDS: Record<string, FlowKind> = {
  "/factura": "invoice",
  "/memo": "memo",
  "/consignacion": "consignment",
  "/consignación": "consignment",
  "/cotizacion": "quote",
  "/cotización": "quote",
  "/compra": "purchase",
};
const NAME: Record<FlowKind, string> = { ...KIND_LABEL, purchase: "Compra" };
const ICON: Record<FlowKind, string> = { invoice: "🧾", memo: "📋", consignment: "🤝", quote: "💬", purchase: "🛒" };
const DUE_DAYS: Record<DocKind, number> = { quote: 7, memo: 14, invoice: 0, consignment: 90 };

// ───────────────────────────── Estado (uno por chat) ─────────────────────────────
const key = (chatId: number) => `tgdoc:${chatId}`;

export async function getFlow(chatId: number): Promise<DocFlow | null> {
  const { data } = await adminDb().from("integration_settings").select("value").eq("key", key(chatId)).maybeSingle();
  try {
    return data ? (JSON.parse(data.value as string) as DocFlow) : null;
  } catch {
    return null;
  }
}
async function saveFlow(chatId: number, flow: DocFlow) {
  await adminDb().from("integration_settings").upsert({ key: key(chatId), value: JSON.stringify(flow), updated_at: new Date().toISOString() }, { onConflict: "key" });
}
export async function clearFlow(chatId: number) {
  await adminDb().from("integration_settings").delete().eq("key", key(chatId));
}

// ───────────────────────────── Inicio ─────────────────────────────
export async function startFlow(chatId: number, kind: FlowKind, arg: string, user: string) {
  const settings = await getDocSettings();
  // Un borrador de publicación a medias se descarta: las fotos que lleguen ahora son para este documento
  const { data: open } = await adminDb().from("bot_drafts").select("id").eq("chat_id", chatId).in("status", ["collecting", "analyzing", "ready"]);
  for (const d of open ?? []) await updateDraft(d.id as string, { status: "cancelled", awaiting: null });

  const flow: DocFlow = { kind, step: "watch", user, lang: "en", tax: kind === "invoice" ? Number(settings.doc_tax_rate) || 0 : 0 };
  await saveFlow(chatId, flow);
  if (kind === "purchase") {
    return sendMessage(chatId, `${ICON.purchase} <b>Compra de un reloj</b>\n\nEnvíame las fotos del reloj (de 1 a 10) y después la referencia y los extras.\n<i>Ej.: Rolex 126610LN, caja y papeles, excelente estado</i>\n\n/cancelar para salir.`);
  }
  if (arg) return onText(chatId, arg, flow);
  return sendMessage(
    chatId,
    `${ICON[kind]} <b>${kind === "consignment" ? "Contrato de consignación" : `Nueva ${NAME[kind].toLowerCase()}`}</b>\n\n⌚ ¿Qué reloj?\n• Escribe la referencia, el modelo o el código del inventario (ej. <code>126610LN</code> o <code>THS-0004</code>)\n• O envíame <b>fotos</b> del reloj si aún no está en el inventario\n\n/cancelar para salir.`
  );
}

// ───────────────────────────── Mensajes de texto ─────────────────────────────
export async function onText(chatId: number, text: string, flow: DocFlow) {
  switch (flow.step) {
    case "watch":
      return pickWatch(chatId, text, flow);
    case "photos": {
      // La nota del reloj (referencia y extras): la IA prepara la ficha con las fotos
      if (!flow.draftId) return sendMessage(chatId, "Envíame primero las fotos del reloj.");
      await adminDb().from("bot_drafts").update({ caption: text, updated_at: new Date().toISOString() }).eq("id", flow.draftId);
      return analyze(chatId, flow.draftId);
    }
    case "client":
      return pickClient(chatId, parseClient(text), flow);
    case "price": {
      const p = parsePrice(text);
      if (!p) return sendMessage(chatId, "No entendí el precio. Escribe un número, ej. <code>14500</code> o <code>14.5k</code>.");
      flow.price = p;
      return afterPrice(chatId, flow);
    }
    case "asking": {
      const p = /^no\b/i.test(text.trim()) ? null : parsePrice(text);
      if (p === undefined) return sendMessage(chatId, "Escribe el precio de la web (ej. <code>23950</code>) o <code>no</code> para no publicarlo.");
      flow.asking = p;
      return confirm(chatId, flow);
    }
    case "confirm":
      // Cualquier texto en la revisión final se guarda como nota del documento
      flow.notes = text.slice(0, 500);
      return confirm(chatId, flow, "📝 Nota añadida.");
  }
}

// Contacto compartido desde el teléfono (📎 → Contacto) en el paso del cliente
export async function onContact(chatId: number, c: { phone_number: string; first_name?: string; last_name?: string }, flow: DocFlow) {
  if (flow.step !== "client") return sendMessage(chatId, "Ahora no necesito un contacto.");
  return pickClient(chatId, { name: [c.first_name, c.last_name].filter(Boolean).join(" ") || null, phone: normalizePhone(c.phone_number), email: null }, flow);
}

// ───────────────────────────── Reloj ─────────────────────────────
const words = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter(Boolean);
const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

async function pickWatch(chatId: number, query: string, flow: DocFlow) {
  const { data } = await adminDb()
    .from("inventory_items")
    .select("id, sku, brand, model, reference, serial, condition, comes_with, papers_date, asking_price, cost, supplier_customer_id, supplier_name")
    .in("status", ["in_stock", "reserved"])
    .order("sku");
  const q = words(query);
  const found = (data ?? []).filter((i) => {
    const hay = `${i.sku} ${i.brand} ${i.model ?? ""} ${i.reference ?? ""}`;
    const w = words(hay);
    return q.every((x) => w.some((y) => y.includes(x))) || (i.reference && compact(query).includes(compact(i.reference as string)));
  });
  if (!found.length) {
    return sendMessage(chatId, `No encontré «${h(query)}» entre los relojes disponibles del inventario.\n\n📸 Envíame las <b>fotos</b> del reloj y lo doy de alta, o escribe otra referencia.`);
  }
  if (found.length > 1) {
    return sendMessage(chatId, "¿Cuál de estos?", {
      reply_markup: keyboard(found.slice(0, 8).map((i) => [{ text: `${i.sku} · ${i.brand} ${i.model ?? ""} ${i.reference ?? ""}`.replace(/\s+/g, " ").slice(0, 60), callback_data: `dsel:${i.id}` }])),
    });
  }
  return setItem(chatId, found[0].id as string, flow);
}

async function setItem(chatId: number, id: string, flow: DocFlow) {
  const { data: i } = await adminDb().from("inventory_items").select("*").eq("id", id).single();
  if (!i) return sendMessage(chatId, "Ese reloj ya no está en el inventario.");
  flow.item = {
    id: i.id, sku: i.sku,
    title: [i.brand, i.model, i.reference].filter(Boolean).join(" "),
    details: [i.condition, i.papers_date ? `Papers ${String(i.papers_date).slice(0, 7)}` : null, i.comes_with].filter(Boolean).join(" · "),
    serial: i.serial, price: i.asking_price == null ? null : Number(i.asking_price), cost: i.cost == null ? null : Number(i.cost),
    ownerId: i.supplier_customer_id, ownerName: i.supplier_name,
  };
  flow.step = "client";
  // Consignación de un reloj que ya está en el inventario: el dueño es su proveedor
  if (flow.kind === "consignment" && i.supplier_customer_id) {
    flow.customerId = i.supplier_customer_id;
    await sendMessage(chatId, `⌚ <b>${h(flow.item.title)}</b> (${h(i.sku)})\n👤 Dueño: ${h(i.supplier_name ?? "del inventario")}`);
    flow.step = "price";
    await saveFlow(chatId, flow);
    return askPrice(chatId, flow);
  }
  await saveFlow(chatId, flow);
  return askClient(chatId, `⌚ <b>${h(flow.item.title)}</b> (${h(i.sku)})`, flow);
}

// Fotos: el borrador de publicación de siempre, pero al terminar la IA vuelve aquí
export async function attachDraft(chatId: number, draftId: string, flow: DocFlow, first: boolean) {
  if (flow.draftId === draftId && flow.step === "photos" && !first) return;
  flow.draftId = draftId;
  flow.step = "photos";
  delete flow.item;
  await saveFlow(chatId, flow);
  if (first) await sendMessage(chatId, "📸 Fotos recibidas. Escríbeme la referencia y los extras (caja, papeles, estado).\n<i>Ej.: Rolex 126610LN, caja y papeles, excelente</i>");
}

// La IA terminó la ficha del reloj nuevo: se sigue con el cliente
export async function afterAnalysis(chatId: number, draftId: string) {
  const flow = await getFlow(chatId);
  if (!flow || flow.draftId !== draftId || flow.step !== "photos") return false;
  const w = await draftWatch(draftId);
  if (!w) return false;
  flow.watch = watchSummary(w);
  const warn = w.warnings.length ? `\n⚠️ ${w.warnings.map(h).join("\n⚠️ ")}` : "";
  const head = `⌚ <b>${h(w.brand)} ${h(w.model)}</b> · Ref. ${h(w.reference)}${w.year ? ` · ${w.year}` : ""}\n${h(flow.watch.details)}${warn}`;
  flow.step = "client";
  await saveFlow(chatId, flow);
  await askClient(chatId, head, flow);
  return true;
}

function watchSummary(w: WatchDraft) {
  return {
    title: `${w.brand} ${w.model} ${w.reference}`.replace(/\s+/g, " ").trim(),
    details: [w.year, w.caseSize, w.hasBox && w.hasPapers ? "Box & papers" : w.hasBox ? "Box" : w.hasPapers ? "Papers" : null].filter(Boolean).join(" · "),
    suggested: w.price,
  };
}

// ───────────────────────────── Cliente ─────────────────────────────
function askClient(chatId: number, head: string, flow: DocFlow) {
  const who = flow.kind === "consignment" ? "¿Quién es el dueño del reloj?" : flow.kind === "purchase" ? "¿A quién se lo compraste?" : flow.kind === "memo" ? "¿A quién se lo entregas en memo?" : "¿Para qué cliente?";
  return sendMessage(chatId, `${head}\n\n👤 ${who}\nEscribe nombre, teléfono y/o correo, o comparte un contacto (📎 → Contacto).`, {
    reply_markup: flow.kind === "purchase" ? keyboard([[{ text: "Omitir", callback_data: "dcli:skip" }]]) : undefined,
  });
}

function parseClient(text: string) {
  const email = text.match(/[^\s,;]+@[^\s,;]+\.[a-z]{2,}/i)?.[0] ?? null;
  const phoneRaw = text.replace(email ?? "", "").match(/\+?\d[\d\s().-]{6,}\d/)?.[0] ?? null;
  const name = text.replace(email ?? "", "").replace(phoneRaw ?? "", "").replace(/[,;·|]+/g, " ").replace(/\s+/g, " ").trim() || null;
  return { name, phone: normalizePhone(phoneRaw), email: email?.toLowerCase() ?? null };
}

async function pickClient(chatId: number, c: { name: string | null; phone: string | null; email: string | null }, flow: DocFlow) {
  const filters = [
    c.phone && `phone.ilike.%${c.phone.replace(/\D/g, "").slice(-7)}%`,
    c.email && `email.eq.${c.email.replace(/[,()"]/g, "")}`,
    c.name && c.name.length > 2 && `name.ilike.%${c.name.replace(/[,()"%]/g, "")}%`,
  ].filter(Boolean).join(",");
  const { data } = filters ? await adminDb().from("customers").select("id, name, phone, email").or(filters).limit(5) : { data: [] };
  flow.client = c;
  await saveFlow(chatId, flow);
  if (!data?.length) {
    if (!c.name && !c.phone && !c.email) return sendMessage(chatId, "No entendí los datos del cliente. Escribe al menos el nombre o el teléfono.");
    return chooseClient(chatId, null, flow);
  }
  const rows: InlineButton[][] = data.map((x) => [{ text: `👤 ${x.name ?? "Sin nombre"}${x.phone ? ` · ${x.phone}` : x.email ? ` · ${x.email}` : ""}`.slice(0, 60), callback_data: `dcli:${x.id}` }]);
  if (c.name || c.phone || c.email) rows.push([{ text: `➕ Nuevo: ${c.name ?? c.phone ?? c.email}`.slice(0, 60), callback_data: "dcli:new" }]);
  return sendMessage(chatId, "Encontré estos clientes en el CRM. ¿Es alguno?", { reply_markup: keyboard(rows) });
}

async function chooseClient(chatId: number, customerId: string | null, flow: DocFlow) {
  flow.customerId = customerId;
  if (customerId) {
    const { data } = await adminDb().from("customers").select("name, phone, email").eq("id", customerId).single();
    flow.client = { name: data?.name ?? null, phone: data?.phone ?? null, email: data?.email ?? null };
  }
  flow.step = "price";
  await saveFlow(chatId, flow);
  return askPrice(chatId, flow);
}

// ───────────────────────────── Precio ─────────────────────────────
function suggested(flow: DocFlow) {
  if (flow.kind === "consignment" || flow.kind === "purchase") return flow.item?.cost ?? null;
  return flow.item?.price ?? flow.watch?.suggested ?? null;
}

function askPrice(chatId: number, flow: DocFlow) {
  const q = {
    invoice: "💵 ¿Precio de venta? (sin impuesto)",
    quote: "💵 ¿Precio de la cotización?",
    memo: "💵 ¿Valor del reloj en el memo?",
    consignment: "💵 ¿Cuánto le pagarás al dueño cuando se venda? (neto al consignante)",
    purchase: "💵 ¿Cuánto pagaste por el reloj?",
  }[flow.kind];
  const s = suggested(flow);
  return sendMessage(chatId, q, s ? { reply_markup: keyboard([[{ text: `Usar ${usd(s)}`, callback_data: `dprice:${s}` }]]) } : {});
}

async function afterPrice(chatId: number, flow: DocFlow) {
  // Reloj nuevo en consignación o compra: ¿se publica en la web?
  if ((flow.kind === "consignment" || flow.kind === "purchase") && flow.draftId) {
    flow.step = "asking";
    await saveFlow(chatId, flow);
    const s = flow.watch?.suggested;
    return sendMessage(chatId, "🌐 ¿A qué precio lo publico en la web?", {
      reply_markup: keyboard([[...(s ? [{ text: `Usar ${usd(s)}`, callback_data: `dask:${s}` }] : []), { text: "No publicar", callback_data: "dask:no" }]]),
    });
  }
  return confirm(chatId, flow);
}

// ───────────────────────────── Revisión final ─────────────────────────────
async function confirm(chatId: number, flow: DocFlow, prefix = "") {
  flow.step = "confirm";
  await saveFlow(chatId, flow);
  const watch = flow.item ? `${flow.item.title} (${flow.item.sku})` : `${flow.watch?.title ?? "Reloj"} (nuevo, se da de alta)`;
  const c = flow.client;
  const who = c ? [c.name, c.phone, c.email].filter(Boolean).join(" · ") : "—";
  const price = flow.price ?? 0;
  const lines = [
    prefix,
    `${ICON[flow.kind]} <b>${flow.kind === "consignment" ? "Contrato de consignación" : NAME[flow.kind]}</b> · revisa antes de crearlo`,
    "",
    `⌚ ${h(watch)}`,
    `👤 ${h(who)}${flow.customerId ? "" : c?.name || c?.phone ? " <i>(nuevo en el CRM)</i>" : ""}`,
  ];
  if (flow.kind === "invoice") {
    const t = docTotals({ items: [{ title: "", qty: 1, price }], discount: 0, tax_rate: flow.tax, shipping: 0 });
    lines.push(`💵 ${usd(price)}${flow.tax ? ` + impuesto ${flow.tax}% = <b>${usd(t.total)}</b>` : " <b>(sin impuesto)</b>"}`);
  } else if (flow.kind === "consignment") {
    lines.push(`💵 Neto al dueño: <b>${usd(price)}</b>`);
  } else if (flow.kind === "purchase") {
    lines.push(`💵 Pagado: <b>${usd(price)}</b>`);
  } else {
    lines.push(`💵 <b>${usd(price)}</b>`);
  }
  if (flow.kind === "consignment" || flow.kind === "purchase") {
    if (flow.draftId) lines.push(flow.asking ? `🌐 Se publica en la web a <b>${usd(flow.asking)}</b>` : "🌐 No se publica en la web");
  }
  if (flow.kind !== "purchase") lines.push(`📄 Documento en ${flow.lang === "en" ? "inglés" : "español"}`);
  if (flow.notes) lines.push(`📝 ${h(flow.notes)}`);
  if (flow.kind !== "purchase") lines.push("", "<i>Escribe un texto si quieres añadir una nota al documento.</i>");

  const rows: InlineButton[][] = [[{ text: flow.kind === "purchase" ? "✅ Registrar compra" : "✅ Crear y enviar", callback_data: "dok:1" }]];
  const opts: InlineButton[] = [];
  if (flow.kind !== "purchase") opts.push({ text: flow.lang === "en" ? "🌐 Cambiar a español" : "🌐 Cambiar a inglés", callback_data: "dlang:1" });
  if (flow.kind === "invoice") opts.push({ text: flow.tax ? "Sin impuesto" : "Con impuesto", callback_data: "dtax:1" });
  if (opts.length) rows.push(opts);
  rows.push([
    { text: "✏️ Precio", callback_data: "dedit:price" },
    { text: "✏️ Cliente", callback_data: "dedit:client" },
    { text: "❌ Cancelar", callback_data: "dcan:1" },
  ]);
  return sendMessage(chatId, lines.filter((l, i) => l || i > 0).join("\n"), { reply_markup: keyboard(rows) });
}

// ───────────────────────────── Crear ─────────────────────────────
export async function finish(chatId: number, flow: DocFlow) {
  const db = adminDb();
  await clearFlow(chatId); // evita que un doble toque cree dos documentos
  await tg("sendChatAction", { chat_id: chatId, action: "upload_document" }).catch(() => {});
  const today = todayInMiami();
  const price = flow.price ?? 0;
  const owner = flow.kind === "consignment" || flow.kind === "purchase";

  // 1. Cliente (o dueño / vendedor) en el CRM
  let customerId = flow.customerId ?? null;
  const c = flow.client;
  if (!customerId && c && (c.name || c.phone || c.email)) {
    const lead = await upsertLead({
      name: c.name, phone: c.phone, email: c.email, source: "walk_in", notify: false,
      intent: flow.kind === "consignment" ? "consign" : flow.kind === "purchase" ? "sell" : "buy",
      event: { type: "note", body: `Alta desde Telegram (${NAME[flow.kind].toLowerCase()})` },
    });
    customerId = lead.id;
  }
  let name = c?.name ?? null;
  if (customerId && !name) name = (await db.from("customers").select("name").eq("id", customerId).single()).data?.name ?? null;

  // 2. Reloj: del inventario, o nuevo (con sus fotos), publicado si se pidió
  let item = flow.item;
  let published: string | null = null;
  if (!item && flow.draftId) {
    const w = (await draftWatch(flow.draftId))!;
    const supplier = owner ? { supplier_customer_id: customerId, supplier_name: name, cost: price } : {};
    const acquisition = flow.kind === "consignment" ? "consignment" : "purchase";
    let itemId: string;
    if (owner && flow.asking) {
      // Publicar: la ficha de la web y su alta en el inventario, como al publicar por Telegram
      const { data: draft } = await db.from("bot_drafts").select("*").eq("id", flow.draftId).single();
      draft.data = { ...draft.data, price: flow.asking };
      const { slug, id } = await publish(draft);
      published = `${SITE_URL}/es/watches/${slug}`;
      const { data: stock } = await db.from("inventory_items").select("id").eq("watch_id", id).single();
      itemId = stock!.id;
      await db.from("inventory_items").update({ acquisition, purchase_date: today, ...supplier }).eq("id", itemId);
      after(() => cutoutJob(chatId, id));
      after(() => notifyAlertMatches(chatId, draft.data, slug).catch((e) => console.error("Avisos:", e)));
    } else {
      const created = await createStockItem(
        {
          acquisition, brand: w.brand, model: w.model, reference: w.reference, condition: "Pre-Owned", purchase_date: today,
          comes_with: [w.hasBox && "Box", w.hasPapers && "Papers"].filter(Boolean).join(", ") || null,
          asking_price: flow.kind === "invoice" || flow.kind === "quote" || flow.kind === "memo" ? price : flow.asking ?? null,
          ...supplier,
        },
        flow.user,
        `Entrada desde Telegram (${NAME[flow.kind].toLowerCase()})${owner ? ` · ${usd(price)}` : ""}`
      );
      itemId = created.id;
      await updateDraft(flow.draftId, { status: "cancelled", awaiting: null }); // las fotos quedan guardadas
    }
    const { data: row } = await db.from("inventory_items").select("sku").eq("id", itemId).single();
    item = { id: itemId, sku: row!.sku, title: flow.watch!.title, details: flow.watch!.details, serial: null, price: null, cost: null, ownerId: null, ownerName: null };
  }
  if (!item) return sendMessage(chatId, "Falta el reloj. Empieza de nuevo con el comando.");

  // Compra: no lleva documento, solo el alta (con costo y vendedor)
  if (flow.kind === "purchase") {
    return sendMessage(
      chatId,
      [`✅ <b>Compra registrada</b> · ${h(item.sku)}`, `${h(item.title)} · costo ${usd(price)}${name ? ` · de ${h(name)}` : ""}`, published ? `🌐 Publicado: ${published}` : "🌐 No publicado en la web", "", `${SITE_URL}/admin/inventario/${item.id}`].join("\n")
    );
  }

  // 3. Documento
  const kind = flow.kind as DocKind;
  const settings = await getDocSettings();
  const due = new Date(new Date(`${today}T12:00:00Z`).getTime() + DUE_DAYS[kind] * 86_400_000).toISOString().slice(0, 10);
  const doc = await insertDoc({
    kind,
    customer_id: customerId,
    client_name: name, client_email: c?.email ?? null, client_phone: c?.phone ?? null,
    lang: flow.lang,
    issue_date: today,
    due_date: due,
    items: [{ item_id: item.id, sku: item.sku, title: item.title, details: item.details || null, serial: item.serial, qty: 1, price }],
    tax_rate: kind === "invoice" ? flow.tax : 0,
    show_serial: kind !== "quote",
    notes: [flow.notes, kind === "consignment" && flow.asking ? (flow.lang === "es" ? `Precio de venta acordado: ${usd(flow.asking)}` : `Agreed listing price: ${usd(flow.asking)}`) : null].filter(Boolean).join("\n") || null,
    terms: termsFor(kind, flow.lang, settings),
    created_by: flow.user,
  });
  await issueDoc(doc, flow.user);
  if (published) await sendMessage(chatId, `🌐 Publicado en la web: ${published}`);
  return deliver(chatId, { ...doc, status: "sent" });
}

// PDF + enlace + botones para seguir (cobrar, devolver, facturar…)
export async function deliver(chatId: number, d: Doc) {
  const link = `${SITE_URL}/d/${d.token}`;
  const first = (d.client_name ?? "").split(" ")[0];
  const label = d.lang === "es" ? KIND_LABEL[d.kind].toLowerCase() : { quote: "quotation", memo: "memorandum", invoice: "invoice", consignment: "consignment agreement" }[d.kind];
  const msg = d.lang === "es"
    ? `Hola ${first}, le comparto su ${label} ${d.number} de The Heure Society: ${link}`
    : `Hi ${first}, here is your ${label} ${d.number} from The Heure Society: ${link}`;
  const phone = d.client_phone?.replace(/\D/g, "");

  const rows: InlineButton[][] = [];
  if (phone) rows.push([{ text: "📲 Enviar al cliente por WhatsApp", url: `https://wa.me/${phone}?text=${encodeURIComponent(msg)}` }]);
  if (d.status === "sent") {
    if (d.kind === "invoice") rows.push([{ text: "💰 Marcar pagada", callback_data: `dpaid:${d.id}` }]);
    if (d.kind === "memo") rows.push([{ text: "↩️ Devuelto", callback_data: `dret:${d.id}` }, { text: "🧾 Se lo queda: facturar", callback_data: `dinv:${d.id}` }]);
    if (d.kind === "consignment") rows.push([{ text: "💵 Vendido: pagado al dueño", callback_data: `down:${d.id}` }, { text: "↩️ Devuelto al dueño", callback_data: `dret:${d.id}` }]);
    if (d.kind === "quote") rows.push([{ text: "🧾 Convertir en factura", callback_data: `dinv:${d.id}` }]);
  }
  rows.push([{ text: "Abrir en el CRM", url: `${SITE_URL}/admin/documentos/${d.id}` }]);

  const caption = [
    `📄 <b>${KIND_LABEL[d.kind]} ${h(d.number)}</b>`,
    `${h(d.client_name ?? "")} · <b>${usd(d.total)}</b>${d.kind === "consignment" ? " neto al dueño" : ""}`,
    "",
    `Enlace para el cliente:\n${link}`,
    phone ? "" : "\n<i>Sin teléfono: reenvía este PDF o el enlace.</i>",
  ].join("\n");
  const pdf = await renderDocPdf(d, await getDocSettings());
  return sendDocumentFile(chatId, pdf, pdfName(d), caption, { reply_markup: keyboard(rows) });
}

// ───────────────────────────── Botones ─────────────────────────────
export async function onCallback(chatId: number, cbId: string, messageId: number, action: string, arg: string, user: string) {
  const answer = (text?: string) => tg("answerCallbackQuery", { callback_query_id: cbId, ...(text && { text }) }).catch(() => {});
  const clearButtons = () => tg("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: keyboard([]) }).catch(() => {});

  // Botones de un documento ya creado (no dependen del asistente)
  if (action === "dtask") {
    const { completeTask } = await import("./tasks");
    const done = await completeTask(arg, user);
    await answer(done ? "Hecho" : "Ya estaba hecho");
    return clearButtons();
  }

  // Consignación sin contrato: confirmar y devolver al dueño desde el inventario
  if (action === "dirq" || action === "dirok") {
    const { data: item } = await adminDb().from("inventory_items").select("*").eq("id", arg).maybeSingle();
    if (!item || (item.status !== "in_stock" && item.status !== "reserved")) {
      await answer("Ese reloj ya no está disponible.");
      return clearButtons();
    }
    await answer();
    if (action === "dirq") {
      return sendMessage(chatId, `¿Devolver <b>${h(item.brand)} ${h(item.model ?? "")}</b> (${h(item.sku)}) a ${h(item.supplier_name ?? "su dueño")}?\nSale del inventario disponible y de la web.`, {
        reply_markup: keyboard([[{ text: "↩️ Sí, devolver", callback_data: `dirok:${item.id}` }, { text: "No", callback_data: "dcan:0" }]]),
      });
    }
    await clearButtons();
    await returnToOwner(item as Item, user, "Devuelto al dueño (desde Telegram)");
    return sendMessage(chatId, `↩️ ${h(item.sku)} devuelto a ${h(item.supplier_name ?? "su dueño")}. Ya no figura como disponible ni en la web.`);
  }

  if (["dpaid", "dpm", "dret", "dinv", "down", "dshow"].includes(action)) {
    const [docId, extra] = arg.split("|");
    const d = await getDoc(docId);
    if (action === "dshow" && d) {
      await answer();
      return deliver(chatId, d);
    }
    if (!d || d.status !== "sent") {
      await answer("Este documento ya está cerrado.");
      return clearButtons();
    }
    if (action === "dpaid") {
      await answer();
      return sendMessage(chatId, `💰 ¿Cómo pagó ${h(d.client_name ?? "el cliente")} la factura ${h(d.number)} (${usd(d.total)})?`, {
        reply_markup: keyboard(Object.entries(PAYMENT).filter(([k]) => k !== "other").reduce<InlineButton[][]>((rows, [k, l], i) => {
          if (i % 3 === 0) rows.push([]);
          rows[rows.length - 1].push({ text: l, callback_data: `dpm:${d.id}|${k}` });
          return rows;
        }, [])),
      });
    }
    if (action === "dpm") {
      await answer("Registrando el pago…");
      await clearButtons();
      const method = PAYMENT[extra as keyof typeof PAYMENT] ?? null;
      await payInvoice(d, method, todayInMiami(), user);
      return sendMessage(chatId, `✅ <b>${h(d.number)} pagada</b> (${h(method ?? "")}). El reloj queda vendido en el inventario y fuera de la web.`);
    }
    if (action === "dret") {
      await answer("Hecho");
      await clearButtons();
      await closeReturned(d, user);
      return sendMessage(chatId, d.kind === "memo" ? `↩️ ${h(d.number)}: reloj devuelto, vuelve a estar disponible.` : `↩️ ${h(d.number)}: reloj devuelto a su dueño; sale del inventario y de la web.`);
    }
    if (action === "down") {
      await answer("Hecho");
      await clearButtons();
      await consignorPaid(d, user);
      return sendMessage(chatId, `💵 ${h(d.number)}: pagado al dueño (${usd(d.total)}).`);
    }
    // dinv: memo o cotización → factura, y se envía al momento
    await answer("Creando la factura…");
    await clearButtons();
    return later(chatId, async () => {
      const invoice = await toInvoice(d, user);
      await issueDoc(invoice, user);
      await deliver(chatId, { ...invoice, status: "sent" });
    });
  }

  if (action === "dcan" && arg === "0") {
    await answer("Cancelado");
    return clearButtons();
  }
  const flow = await getFlow(chatId);
  if (!flow) {
    await answer("Este asistente ya terminó.");
    return clearButtons();
  }
  await answer();
  switch (action) {
    case "dsel":
      await clearButtons();
      return setItem(chatId, arg, flow);
    case "dcli":
      await clearButtons();
      if (arg === "skip") {
        flow.client = undefined;
        flow.customerId = null;
        flow.step = "price";
        await saveFlow(chatId, flow);
        return askPrice(chatId, flow);
      }
      return chooseClient(chatId, arg === "new" ? null : arg, flow);
    case "dprice":
      await clearButtons();
      flow.price = Number(arg);
      return afterPrice(chatId, flow);
    case "dask":
      await clearButtons();
      flow.asking = arg === "no" ? null : Number(arg);
      return confirm(chatId, flow);
    case "dlang":
      await clearButtons();
      flow.lang = flow.lang === "en" ? "es" : "en";
      return confirm(chatId, flow);
    case "dtax": {
      await clearButtons();
      flow.tax = flow.tax ? 0 : Number((await getDocSettings()).doc_tax_rate) || 0;
      return confirm(chatId, flow);
    }
    case "dedit":
      await clearButtons();
      if (arg === "client") {
        flow.step = "client";
        flow.customerId = undefined;
        await saveFlow(chatId, flow);
        return askClient(chatId, "✏️ Cambiar cliente", flow);
      }
      flow.step = "price";
      await saveFlow(chatId, flow);
      return askPrice(chatId, flow);
    case "dcan":
      await clearButtons();
      await clearFlow(chatId);
      return sendMessage(chatId, "Cancelado. No se creó nada.");
    case "dok":
      await clearButtons();
      if (flow.step !== "confirm") return;
      await sendMessage(chatId, flow.kind === "purchase" ? "⏳ Registrando la compra…" : "⏳ Creando el documento y el PDF…");
      return later(chatId, () => finish(chatId, flow));
  }
}

// Crear el documento (y publicar el reloj) tarda unos segundos: se hace después de responder a Telegram
function later(chatId: number, task: () => Promise<unknown>) {
  after(async () => {
    try {
      await task();
    } catch (e) {
      console.error("Documento desde Telegram:", e);
      await sendMessage(chatId, `⚠️ No se pudo terminar: ${h((e as Error).message)}`).catch(() => {});
    }
  });
}

// /seguimientos: lo que toca hoy, con el mensaje de WhatsApp listo y botón de hecho
export async function listFollowUps(chatId: number) {
  const { followUpsDue } = await import("./crm");
  const items = await followUpsDue(Date.now(), todayInMiami());
  if (!items.length) return sendMessage(chatId, "✅ Todo al día: no hay seguimientos para hoy.");
  await sendMessage(chatId, `<b>Seguimientos para hoy</b> (${items.length})`);
  for (const f of items.slice(0, 15)) {
    const rows: InlineButton[][] = [];
    if (f.wa) rows.push([{ text: "📲 WhatsApp", url: f.wa }]);
    if (f.taskId) rows.push([{ text: "✓ Hecho", callback_data: `dtask:${f.taskId}` }]);
    rows.push([{ text: "Ficha en el CRM", url: `${SITE_URL}/admin/leads/${f.id}` }]);
    await sendMessage(chatId, `${f.taskId ? "⭐" : f.scheduled ? "⏰" : "💤"} <b>${h(f.name ?? "Sin nombre")}</b>\n${h(f.reason)}`, { reply_markup: keyboard(rows) });
  }
  if (items.length > 15) await sendMessage(chatId, `…y ${items.length - 15} más en el CRM: ${SITE_URL}/admin/leads?follow=1`);
}

// /pdf INV-2026-0003: vuelve a enviar un documento
export async function resendDoc(chatId: number, number: string) {
  const { data } = await adminDb().from("documents").select("*").ilike("number", number.trim()).maybeSingle();
  if (!data) return sendMessage(chatId, `No encontré el documento «${h(number)}».`);
  if (data.status === "draft") return sendMessage(chatId, "Ese documento es un borrador: emítelo primero en el CRM.");
  return deliver(chatId, data as Doc);
}

// /documentos, /consignaciones, /memos, /facturas: lo abierto, con un botón por documento.
// Al tocarlo llega el PDF con sus botones (devuelto, pagado, facturar…).
const LIST_TITLE: Record<string, string> = {
  all: "Documentos abiertos",
  consignment: "Consignaciones activas",
  memo: "Relojes en memo",
  invoice: "Facturas por cobrar",
  quote: "Cotizaciones abiertas",
};

export async function listOpenDocs(chatId: number, kind: DocKind | "all" = "all") {
  let q = adminDb().from("documents").select("id, kind, number, client_name, total, due_date, items").eq("status", "sent").order("created_at", { ascending: false }).limit(30);
  if (kind !== "all") q = q.eq("kind", kind);
  const { data } = await q;
  const docs = data ?? [];
  const today = todayInMiami();
  const rows: InlineButton[][] = docs.map((d) => {
    const late = d.due_date && d.due_date < today && d.kind !== "quote";
    const watch = ((d.items as { title: string }[])[0]?.title ?? "").split(" ").slice(0, 3).join(" ");
    return [{ text: `${late ? "⚠️" : ICON[d.kind as DocKind]} ${d.number} · ${d.client_name ?? ""} · ${watch}`.replace(/\s+/g, " ").slice(0, 62), callback_data: `dshow:${d.id}` }];
  });

  // Consignaciones del inventario que no tienen contrato (entraron por Compras o a mano)
  let loose: { id: string; sku: string; brand: string; model: string | null; supplier_name: string | null }[] = [];
  if (kind === "consignment") {
    const inDocs = new Set(docs.flatMap((d) => (d.items as { item_id?: string }[]).map((l) => l.item_id).filter(Boolean)));
    const { data: items } = await adminDb().from("inventory_items").select("id, sku, brand, model, supplier_name").eq("acquisition", "consignment").in("status", ["in_stock", "reserved"]).order("sku");
    loose = (items ?? []).filter((i) => !inDocs.has(i.id));
    for (const i of loose) rows.push([{ text: `📦 ${i.sku} · ${i.brand} ${i.model ?? ""} · ${i.supplier_name ?? "sin dueño"}`.replace(/\s+/g, " ").slice(0, 62), callback_data: `dirq:${i.id}` }]);
  }

  if (!rows.length) return sendMessage(chatId, kind === "all" ? "No hay documentos abiertos." : `No hay ${LIST_TITLE[kind].toLowerCase()}.`);
  const help =
    kind === "consignment"
      ? `Toca una para ver el contrato con sus botones (<b>Devuelto al dueño</b> o <b>Pagado al dueño</b>).${loose.length ? "\n📦 = reloj en consignación sin contrato." : ""}`
      : "Toca uno para recibir el PDF con sus botones.";
  return sendMessage(chatId, `<b>${LIST_TITLE[kind]}</b> (${rows.length})\n⚠️ = plazo vencido\n\n${help}`, { reply_markup: keyboard(rows) });
}
