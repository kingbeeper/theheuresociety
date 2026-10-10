import "server-only";
import { after } from "next/server";
import { adminDb } from "./supabase";
import { escapeHtml as h, escapeHtml, keyboard, sendMessage, tg, type InlineButton } from "./telegram";
import { clearFlow, clearPendingCost, costCommand, demandSummary, listFollowUps, listOpenDocs, clearAppraise, startAppraisal, startFlow } from "./bot-docs";
import { cutoutJob, setWatchStatus } from "./bot";

// Menú con botones: un teclado fijo abajo con lo principal, y submenús con botones para todo lo
// demás. Así no hace falta recordar ni escribir órdenes (las órdenes siguen funcionando).

import { MENU, WELCOME, mainKeyboard } from "./bot-keyboard";
export { MENU, WELCOME, mainKeyboard };

export const showMenu = (chatId: number, text: string = WELCOME) => sendMessage(chatId, text, { reply_markup: mainKeyboard });

const pairs = (buttons: InlineButton[]) =>
  buttons.reduce<InlineButton[][]>((rows, b, i) => (i % 2 ? rows[rows.length - 1].push(b) : rows.push([b]), rows), []);

// Botones del teclado fijo (llegan como texto). Devuelve true si el texto era un botón.
export async function onMenuText(chatId: number, text: string, user: string) {
  switch (text) {
    case MENU.publish:
      // Lo que estuviera a medias (un documento, la pregunta del costo) se deja: ahora las fotos son para publicar
      await clearFlow(chatId);
      await clearPendingCost(chatId);
      await clearAppraise(chatId);
      await (await import("./bot-sourcing")).clearSourcing(chatId);
      await sendMessage(chatId, "📸 <b>Publicar un reloj</b>\n\n1. Envíame las fotos (de 1 a 10).\n2. Después escríbeme la referencia, el precio y los extras.\n<i>Ej.: Rolex 126610LN, 14500, caja y papeles</i>\n\nPrepararé la ficha y te la enseño antes de publicarla.");
      return true;
    case MENU.docs:
      await sendMessage(chatId, "🧾 <b>Documentos</b>\n¿Qué quieres hacer?", {
        reply_markup: keyboard([
          ...pairs([
            { text: "🧾 Factura", callback_data: "mnew:invoice" },
            { text: "📋 Memo", callback_data: "mnew:memo" },
            { text: "🤝 Consignación", callback_data: "mnew:consignment" },
            { text: "💬 Cotización", callback_data: "mnew:quote" },
          ]),
          [{ text: "🛒 Compré un reloj", callback_data: "mnew:purchase" }],
          [{ text: "🔎 Encargo con anticipo", callback_data: "mnew:sourcing" }],
          [{ text: "📂 Ver documentos abiertos", callback_data: "mopen:menu" }],
        ]),
      });
      return true;
    case MENU.money:
      await sendMessage(chatId, "💵 <b>Costos y gastos</b>", {
        reply_markup: keyboard([
          [{ text: "💵 Poner lo que costó un reloj", callback_data: "mcost:cost" }],
          [{ text: "🧾 Sumar un gasto (servicio, pulido…)", callback_data: "mcost:extra" }],
        ]),
      });
      return true;
    case MENU.stock:
      await sendMessage(chatId, "⌚ <b>Inventario</b>", {
        reply_markup: keyboard([
          [{ text: "📋 Ver lo publicado", callback_data: "mlist:1" }],
          ...pairs([
            { text: "✅ Marcar vendido", callback_data: "mst:sold" },
            { text: "🟡 Marcar reservado", callback_data: "mst:reserved" },
            { text: "🟢 Volver a disponible", callback_data: "mst:available" },
            { text: "✂️ Repetir recorte", callback_data: "mst:case" },
          ]),
          [{ text: "🔎 Tasar un reloj (fotos)", callback_data: "mappr:1" }],
          [{ text: "🏷 Relojes para rebajar", callback_data: "mdrop:1" }],
          [{ text: "🎬 Video promocional", callback_data: "mst:video" }],
          [{ text: "📊 Qué buscan los clientes", callback_data: "mdem:1" }],
        ]),
      });
      return true;
    case MENU.clients: {
      const { sendTaskList } = await import("./staff-tasks");
      await sendTaskList(chatId, user).catch(() => false);
      await listFollowUps(chatId);
      return true;
    }
    case MENU.social:
      await sendMessage(chatId, "📣 <b>Redes</b>", {
        reply_markup: keyboard([
          [{ text: "📈 ¿Cómo van las redes?", callback_data: "msoc:pulse" }],
          [{ text: "💡 Ideas para publicar", callback_data: "msoc:plan" }],
          [{ text: "📅 Lo que toca publicar", callback_data: "msoc:cal" }],
          [{ text: "💬 Comentarios sin responder", callback_data: "msoc:comments" }],
          [{ text: "🏁 Competencia", callback_data: "msoc:comp" }],
        ]),
      });
      return true;
    case MENU.help:
      await showMenu(chatId);
      return true;
  }
  void user;
  return false;
}

const MENU_ACTIONS = new Set(["mnew", "mopen", "mcost", "mlist", "mst", "mset", "mcase", "mdem", "mappr", "mdrop", "mvid", "msoc"]);
export const isMenuAction = (action: string) => MENU_ACTIONS.has(action);

type Watch = { id: string; brand: string; model: string; reference: string; status: string };

// Botones de los submenús
export async function onMenuCallback(chatId: number, cbId: string, messageId: number, action: string, arg: string, user: string) {
  await tg("answerCallbackQuery", { callback_query_id: cbId }).catch(() => {});
  const clearButtons = () => tg("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: keyboard([]) }).catch(() => {});

  switch (action) {
    case "mnew":
      await clearButtons();
      if (arg === "sourcing") {
        await clearFlow(chatId);
        const { startSourcing } = await import("./bot-sourcing");
        return startSourcing(chatId, user);
      }
      return startFlow(chatId, arg as Parameters<typeof startFlow>[1], "", user);

    case "mopen":
      if (arg === "menu") {
        return sendMessage(chatId, "📂 ¿Cuáles quieres ver?", {
          reply_markup: keyboard(
            pairs([
              { text: "💰 Facturas por cobrar", callback_data: "mopen:invoice" },
              { text: "🤝 Consignaciones", callback_data: "mopen:consignment" },
              { text: "📋 Memos", callback_data: "mopen:memo" },
              { text: "🔎 Encargos", callback_data: "mopen:sourcing" },
              { text: "📂 Todos", callback_data: "mopen:all" },
            ])
          ),
        });
      }
      return listOpenDocs(chatId, arg as Parameters<typeof listOpenDocs>[1]);

    case "mcost":
      await clearButtons();
      return costCommand(chatId, "", user, arg === "extra" ? "extra" : "cost");

    case "mdem":
      return demandSummary(chatId);

    case "mdrop": {
      const { sendDrops } = await import("./pricing");
      return sendDrops(chatId);
    }

    case "mappr":
      await clearButtons();
      return startAppraisal(chatId);

    case "mlist": {
      const { data } = await adminDb().from("watches").select("brand, model, reference, status, price, currency").in("status", ["available", "reserved", "sold"]).order("published_at", { ascending: false }).limit(20);
      if (!data?.length) return sendMessage(chatId, "Todavía no hay relojes publicados.");
      const icon: Record<string, string> = { available: "🟢", reserved: "🟡", sold: "⚫" };
      return sendMessage(chatId, `<b>Publicados</b>\n🟢 disponible · 🟡 reservado · ⚫ vendido\n\n${data.map((r) => `${icon[r.status]} ${h(r.brand)} ${h(r.model)} · ${h(r.reference)}${r.price ? ` · ${r.currency} ${Number(r.price).toLocaleString("en-US")}` : ""}`).join("\n")}`);
    }

    // Elegir el reloj: para cambiar su estado o repetir su recorte
    case "mst": {
      const from = { sold: ["available", "reserved"], reserved: ["available"], available: ["reserved", "sold"], case: ["available", "reserved"], video: ["available", "reserved"] }[arg] ?? ["available"];
      const { data } = await adminDb().from("watches").select("id, brand, model, reference, status").in("status", from).order("published_at", { ascending: false }).limit(24);
      const watches = (data ?? []) as Watch[];
      if (!watches.length) return sendMessage(chatId, "No hay relojes para esa opción.");
      const title = { sold: "¿Cuál se vendió?", reserved: "¿Cuál reservamos?", available: "¿Cuál vuelve a estar disponible?", case: "¿De cuál repito el recorte del estuche?", video: "🎬 ¿De qué reloj hago el video promocional?" }[arg] ?? "¿Cuál?";
      return sendMessage(chatId, title, {
        reply_markup: keyboard(watches.map((w) => [{ text: `${w.status === "reserved" ? "🟡 " : w.status === "sold" ? "⚫ " : ""}${w.brand} ${w.model} · ${w.reference}`.slice(0, 60), callback_data: arg === "case" ? `mcase:${w.id}` : arg === "video" ? `mvid:${w.id}` : `mset:${w.id}|${arg}` }])),
      });
    }

    case "mset": {
      await clearButtons();
      const [id, status] = arg.split("|");
      const { data: w } = await adminDb().from("watches").select("id, brand, model, reference").eq("id", id).maybeSingle();
      if (!w || !["sold", "reserved", "available"].includes(status)) return sendMessage(chatId, "Ese reloj ya no está publicado.");
      return setWatchStatus(chatId, w as Watch, status as "sold" | "reserved" | "available");
    }

    case "mvid": {
      await clearButtons();
      const { promoConfigured } = await import("./promo-video");
      if (!promoConfigured()) return sendMessage(chatId, "El video promocional aún no está activado: falta la clave de la API de Higgsfield (HF_API_KEY_ID y HF_API_KEY_SECRET).");
      if (arg === "no") return;
      const [watchId, opening, scenario] = arg.split("|");
      // Paso 1: apertura · paso 2: cierre · con las dos: se genera
      if (!scenario) {
        const { openingButtons, closingButtons, label } = await import("./promo-video");
        const { data: w } = await adminDb().from("watches").select("brand, model").eq("id", watchId).maybeSingle();
        if (!w) return sendMessage(chatId, "Ese reloj ya no está publicado.");
        if (!opening) return sendMessage(chatId, `🎬 <b>Video promocional</b> · ${h(w.brand)} ${h(w.model)} (≈ $0,45)\n\n<b>1/2 · Primeros 5 s:</b> ¿cómo se presenta el reloj?\nO pulsa 🎲 y elijo yo las dos tomas.`, { reply_markup: keyboard(openingButtons(watchId)) });
        return sendMessage(chatId, `Apertura: ${label(opening)}\n\n<b>2/2 · Cierre con la marca:</b> ¿en qué escena?`, { reply_markup: keyboard(closingButtons(watchId, opening)) });
      }
      const { promoJob } = await import("./bot");
      after(() => promoJob(chatId, watchId, opening, scenario));
      return;
    }

    case "msoc":
      return socialMenu(chatId, arg, user);

    case "mcase":
      await clearButtons();
      after(() => cutoutJob(chatId, arg));
      return;
  }
}

// ───────────────────────────── Redes ─────────────────────────────
const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://theheuresociety.vercel.app").replace(/\/$/, "");
const num = (v: number | null | undefined) => (v == null ? "—" : Math.round(v).toLocaleString("es-ES"));

async function socialMenu(chatId: number, what: string, user: string) {
  if (what === "pulse") {
    const { socialPulse, socialInsights, bestSlot } = await import("./social-health");
    const [p, i] = await Promise.all([socialPulse(), socialInsights()]);
    const b = bestSlot(i);
    const head = p.status === "ok" ? "✅ <b>Las redes van bien</b>" : p.status === "warn" ? "📉 <b>Las redes están flojas</b>" : "🚨 <b>Las redes están paradas</b>";
    return sendMessage(chatId, [
      head,
      ...p.reasons.map((r) => `• ${escapeHtml(r)}`),
      "",
      `Alcance 7 días: <b>${num(p.week.reach)}</b> · interacciones: <b>${num(p.week.interactions)}</b>`,
      `Seguidores: ${num(p.followers.now)}${p.followers.delta7 != null ? ` (${p.followers.delta7 >= 0 ? "+" : ""}${p.followers.delta7} en 7 días)` : ""}`,
      "",
      `🏆 Lo que mejor te funciona: <b>${b.format ?? "—"}</b>, los <b>${b.weekday ?? "—"}</b> por la <b>${b.slot ?? "—"}</b>.`,
      `${SITE}/admin/redes/engagement`,
    ].join("\n"), { reply_markup: keyboard([[{ text: "💡 Dame ideas para publicar", callback_data: "msoc:plan" }]]) });
  }
  if (what === "plan") {
    await sendMessage(chatId, "💡 Preparando ideas con tu inventario, lo que buscan los clientes y lo que mejor te funciona… (alrededor de un minuto)");
    after(async () => {
      try {
        const { generateContentPlan } = await import("./social-growth");
        const { sendIdeas } = await import("./social-ideas");
        await sendIdeas((await generateContentPlan(user)) as never, chatId);
      } catch (e) {
        await sendMessage(chatId, `⚠️ No pude preparar las ideas: ${escapeHtml((e as Error).message.slice(0, 200))}`);
      }
    });
    return;
  }
  if (what === "cal") {
    const { data } = await adminDb().from("content_ideas").select("*").eq("status", "approved").order("scheduled_for").limit(10);
    if (!data?.length) return sendMessage(chatId, "No hay nada en el calendario. Pide ideas y aprueba las que te gusten.", { reply_markup: keyboard([[{ text: "💡 Ideas para publicar", callback_data: "msoc:plan" }]]) });
    const { ideaMessage } = await import("./social-ideas");
    for (const i of data) {
      const m = await ideaMessage(i as never, "reminder");
      await sendMessage(chatId, m.text, m.extra);
    }
    return;
  }
  if (what === "comments") {
    const { unansweredComments } = await import("./social-growth");
    const list = await unansweredComments(10);
    if (!list.length) return sendMessage(chatId, "✅ No hay comentarios sin responder.");
    return sendMessage(chatId, [
      `<b>💬 Comentarios sin responder</b> (${list.length})`,
      ...list.map((c) => `• @${escapeHtml(c.from_username ?? "alguien")}: «${escapeHtml((c.text as string).slice(0, 80))}»${c.suggested_reply ? `\n   ↳ <i>${escapeHtml(c.suggested_reply as string)}</i>` : ""}`),
      "",
      `Respóndelos con un toque en el CRM: ${SITE}/admin/redes/engagement`,
    ].join("\n"));
  }
  if (what === "comp") {
    const { competitorBoard } = await import("./social-growth");
    const rows = await competitorBoard();
    if (rows.length < 2) return sendMessage(chatId, `Añade las cuentas de la competencia en el CRM: ${SITE}/admin/redes/engagement`);
    return sendMessage(chatId, [
      "<b>🏁 Competencia</b> (posts/semana · ♥+💬 por post · % reels)",
      ...rows.map((c) => c.error ? `• @${escapeHtml(c.username)}: ${escapeHtml(c.error)}` : `• ${c.mine ? "<b>" : ""}@${escapeHtml(c.username)}${c.mine ? " (tú)</b>" : ""}: ${num(c.followers)} seg. · ${c.postsPerWeek ?? "—"} · ${num(c.avgInteractions)} · ${c.reelsShare == null ? "—" : Math.round(c.reelsShare * 100) + "%"}`),
    ].join("\n"));
  }
}
