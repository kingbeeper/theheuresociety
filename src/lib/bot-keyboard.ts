// Teclado fijo del robot y su texto de bienvenida (sin dependencias: lo usan bot.ts y bot-menu.ts)

export const MENU = {
  publish: "📸 Publicar reloj",
  docs: "🧾 Documentos",
  money: "💵 Costos y gastos",
  stock: "⌚ Inventario",
  clients: "👥 Clientes de hoy",
  help: "❓ Ayuda",
  social: "📣 Redes",
} as const;

export const mainKeyboard = {
  keyboard: [
    [{ text: MENU.publish }, { text: MENU.docs }],
    [{ text: MENU.money }, { text: MENU.stock }],
    [{ text: MENU.clients }, { text: MENU.social }],
    [{ text: MENU.help }],
  ],
  resize_keyboard: true,
  is_persistent: true,
  input_field_placeholder: "Elige una opción o envía fotos",
};

export const WELCOME = `<b>The Heure Society</b> 👋

Usa los botones de abajo:

📸 <b>Publicar reloj</b> — envía las fotos y una nota; preparo la ficha para la web
🧾 <b>Documentos</b> — factura, memo, consignación, cotización o compra, en PDF al momento
💵 <b>Costos y gastos</b> — lo que costó cada reloj y sus gastos (para el margen)
⌚ <b>Inventario</b> — marcar vendido o reservado, ver lo publicado, el estuche…
👥 <b>Clientes de hoy</b> — a quién escribir hoy, con el mensaje ya preparado
📣 <b>Redes</b> — cómo van, ideas para publicar con el texto listo, comentarios y competencia
❓ <b>Ayuda</b> — esta explicación

En cualquier momento puedes tocar <b>Cancelar</b> en los mensajes, o escribir /cancelar.`;
