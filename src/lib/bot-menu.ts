import "server-only";
import { after } from "next/server";
import { adminDb } from "./supabase";
import { escapeHtml as h, keyboard, sendMessage, tg, type InlineButton } from "./telegram";
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
    case MENU.help:
      await showMenu(chatId);
      return true;
  }
  void user;
  return false;
}

const MENU_ACTIONS = new Set(["mnew", "mopen", "mcost", "mlist", "mst", "mset", "mcase", "mdem", "mappr", "mdrop"]);
export const isMenuAction = (action: string) => MENU_ACTIONS.has(action);

type Watch = { id: string; brand: string; model: string; reference: string; status: string };

// Botones de los submenús
export async function onMenuCallback(chatId: number, cbId: string, messageId: number, action: string, arg: string, user: string) {
  await tg("answerCallbackQuery", { callback_query_id: cbId }).catch(() => {});
  const clearButtons = () => tg("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: keyboard([]) }).catch(() => {});

  switch (action) {
    case "mnew":
      await clearButtons();
      return startFlow(chatId, arg as Parameters<typeof startFlow>[1], "", user);

    case "mopen":
      if (arg === "menu") {
        return sendMessage(chatId, "📂 ¿Cuáles quieres ver?", {
          reply_markup: keyboard(
            pairs([
              { text: "💰 Facturas por cobrar", callback_data: "mopen:invoice" },
              { text: "🤝 Consignaciones", callback_data: "mopen:consignment" },
              { text: "📋 Memos", callback_data: "mopen:memo" },
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
      const from = { sold: ["available", "reserved"], reserved: ["available"], available: ["reserved", "sold"], case: ["available", "reserved"] }[arg] ?? ["available"];
      const { data } = await adminDb().from("watches").select("id, brand, model, reference, status").in("status", from).order("published_at", { ascending: false }).limit(24);
      const watches = (data ?? []) as Watch[];
      if (!watches.length) return sendMessage(chatId, "No hay relojes para esa opción.");
      const title = { sold: "¿Cuál se vendió?", reserved: "¿Cuál reservamos?", available: "¿Cuál vuelve a estar disponible?", case: "¿De cuál repito el recorte del estuche?" }[arg] ?? "¿Cuál?";
      return sendMessage(chatId, title, {
        reply_markup: keyboard(watches.map((w) => [{ text: `${w.status === "reserved" ? "🟡 " : w.status === "sold" ? "⚫ " : ""}${w.brand} ${w.model} · ${w.reference}`.slice(0, 60), callback_data: arg === "case" ? `mcase:${w.id}` : `mset:${w.id}|${arg}` }])),
      });
    }

    case "mset": {
      await clearButtons();
      const [id, status] = arg.split("|");
      const { data: w } = await adminDb().from("watches").select("id, brand, model, reference").eq("id", id).maybeSingle();
      if (!w || !["sold", "reserved", "available"].includes(status)) return sendMessage(chatId, "Ese reloj ya no está publicado.");
      return setWatchStatus(chatId, w as Watch, status as "sold" | "reserved" | "available");
    }

    case "mcase":
      await clearButtons();
      after(() => cutoutJob(chatId, arg));
      return;
  }
}
