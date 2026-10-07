import { after } from "next/server";
import { handleCallback, handleMessage, type TgCallback, type TgMessage } from "@/lib/bot";
import { isAdmin, sendMessage } from "@/lib/telegram";

// El análisis con IA puede tardar: margen para la función en Vercel
export const maxDuration = 120;

// Telegram llama aquí con cada mensaje que recibe el robot (webhook)
export async function POST(request: Request) {
  // Solo Telegram conoce este secreto (se fija al registrar el webhook)
  if (request.headers.get("x-telegram-bot-api-secret-token") !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  const update = (await request.json()) as { message?: TgMessage; callback_query?: TgCallback };
  const userId = update.message?.from?.id ?? update.callback_query?.from.id;
  const chatId = update.message?.chat.id ?? update.callback_query?.message?.chat.id;

  const run = async (task: () => Promise<unknown>) => {
    try {
      await task();
    } catch (e) {
      console.error("Error del robot de Telegram:", e);
      if (chatId) await sendMessage(chatId, "⚠️ Algo falló procesando tu mensaje. Inténtalo de nuevo en un momento.").catch(() => {});
    }
  };

  if (!isAdmin(userId)) {
    if (chatId)
      await run(() =>
        sendMessage(chatId, `Este robot es privado.\nTu ID de Telegram es <code>${userId}</code>: compártelo con el administrador si necesitas acceso.`)
      );
    return new Response("ok");
  }

  // Botones y órdenes son rápidos y actualizan la web: se procesan antes de responder
  if (update.callback_query) {
    await run(() => handleCallback(update.callback_query!));
  } else if (update.message?.text?.startsWith("/")) {
    await run(() => handleMessage(update.message!));
  } else if (update.message) {
    // Fotos y análisis con IA tardan: se responde a Telegram ya (si no, reintenta) y se sigue después
    const message = update.message;
    after(() => run(() => handleMessage(message)));
  }

  return new Response("ok");
}
