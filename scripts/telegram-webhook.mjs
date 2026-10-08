// Registra la dirección del robot en Telegram. Ejecutar una vez tras publicar en Vercel:
//   node --env-file=.env.local scripts/telegram-webhook.mjs
const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://theheuresociety.vercel.app";

if (!token || !secret) {
  console.error("Faltan TELEGRAM_BOT_TOKEN o TELEGRAM_WEBHOOK_SECRET en .env.local");
  process.exit(1);
}

const call = async (method, body) => {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
};

const url = `${site}/api/telegram`;
console.log("Webhook:", await call("setWebhook", {
  url,
  secret_token: secret,
  allowed_updates: ["message", "callback_query"],
  drop_pending_updates: true,
}));
console.log("Órdenes:", await call("setMyCommands", {
  commands: [
    { command: "ayuda", description: "Cómo publicar un reloj" },
    { command: "lista", description: "Últimos relojes publicados" },
    { command: "vista", description: "Volver a ver la ficha del borrador" },
    { command: "vendido", description: "Marcar como vendido (referencia)" },
    { command: "reservado", description: "Marcar como reservado (referencia)" },
    { command: "disponible", description: "Volver a disponible (referencia)" },
    { command: "estuche", description: "Repetir el recorte del estuche (referencia)" },
    { command: "cancelar", description: "Descartar el borrador actual" },
  ],
}));
console.log("Estado:", (await call("getWebhookInfo", {})).result);
