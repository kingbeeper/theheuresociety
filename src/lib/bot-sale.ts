import "server-only";
import { adminDb } from "./supabase";
import { normalizePhone } from "./crm";
import { getDocSettings, openInvoiceFor, payInvoice, sellViaInvoice } from "./documents";
import { docTotals, usd } from "./doc-labels";
import { PAYMENT } from "./stock-labels";
import { todayInMiami } from "./booking";
import { escapeHtml as h, keyboard, sendMessage, tg, type InlineButton } from "./telegram";

// «Marcar vendido» por Telegram = factura pagada: se piden los datos que faltan (comprador, precio,
// impuesto y forma de pago) y se genera la factura cerrada, que llega en PDF. Si el reloj ya tenía una
// factura abierta, solo se pregunta cómo pagó y se cobra esa.

type SaleFlow = {
  step: "client" | "price" | "tax" | "method" | "confirm";
  user: string;
  itemId: string;
  title: string;
  asking: number | null;
  customerId?: string | null;
  name?: string | null;
  phone?: string | null;
  price?: number;
  tax?: number;
  method?: string;
  lang: "en" | "es";
};

const key = (chatId: number) => `tgsale:${chatId}`;
async function getFlow(chatId: number) {
  const { data } = await adminDb().from("integration_settings").select("value").eq("key", key(chatId)).maybeSingle();
  try {
    return data ? (JSON.parse(data.value as string) as SaleFlow) : null;
  } catch {
    return null;
  }
}
const saveFlow = (chatId: number, f: SaleFlow) =>
  adminDb().from("integration_settings").upsert({ key: key(chatId), value: JSON.stringify(f), updated_at: new Date().toISOString() }, { onConflict: "key" });
export const clearSale = (chatId: number) => adminDb().from("integration_settings").delete().eq("key", key(chatId));

const methods = Object.values(PAYMENT);
const methodButtons = (prefix: string) => methods.map((m, i) => ({ text: m, callback_data: `${prefix}${i}` }));
const pairs = <T,>(xs: T[]) => xs.reduce<T[][]>((acc, x, i) => (i % 2 ? acc[acc.length - 1].push(x) : acc.push([x]), acc), []);

async function deliverPaid(chatId: number, id: string) {
  const { getDoc } = await import("./documents");
  const d = await getDoc(id);
  if (!d) return;
  const { deliver } = await import("./bot-docs");
  await sendMessage(chatId, `✅ <b>Venta registrada</b> · ${h(d.number)} pagada (${usd(d.total)}). El reloj queda vendido en el inventario y en la web.`);
  return deliver(chatId, d);
}

export async function startSale(chatId: number, itemId: string, user: string) {
  const { data: i } = await adminDb().from("inventory_items").select("id, sku, brand, model, reference, asking_price, status").eq("id", itemId).single();
  if (!i) return sendMessage(chatId, "No encontré ese reloj en el inventario.");
  if (i.status === "sold") return sendMessage(chatId, `${h(i.sku)} ya figura como vendido.`);
  const title = `${i.sku} · ${[i.brand, i.model, i.reference].filter(Boolean).join(" ")}`;
  const open = await openInvoiceFor(itemId);
  if (open) {
    await saveFlow(chatId, { step: "method", user, itemId, title, asking: null, lang: open.lang });
    return sendMessage(chatId, `🧾 <b>${h(title)}</b>\nYa tiene la factura <b>${h(open.number)}</b> de ${h(open.client_name ?? "")} por ${usd(open.total)}.\n\n💳 ¿Cómo pagó? (se marca pagada esa factura)`, {
      reply_markup: keyboard([...pairs(methodButtons("dsale:paid|")), [{ text: "❌ Cancelar", callback_data: "dsale:no|1" }]]),
    });
  }
  await saveFlow(chatId, { step: "client", user, itemId, title, asking: i.asking_price == null ? null : Number(i.asking_price), lang: "en" });
  return sendMessage(chatId, `✅ <b>Vender ${h(title)}</b>\nPara cerrar la venta hago la factura pagada. Necesito unos datos.\n\n👤 ¿Quién lo compró? Nombre y teléfono.\n<i>Ej.: Carlos Méndez 305 555 1234</i>\n\n/cancelar para salir.`);
}

async function askPrice(chatId: number, f: SaleFlow) {
  f.step = "price";
  await saveFlow(chatId, f);
  return sendMessage(chatId, "💵 ¿Precio de venta? (sin impuesto)", f.asking ? { reply_markup: keyboard([[{ text: `Usar ${usd(f.asking)}`, callback_data: `dsale:price|${f.asking}` }]]) } : {});
}

async function askTax(chatId: number, f: SaleFlow) {
  f.step = "tax";
  await saveFlow(chatId, f);
  const rate = Number((await getDocSettings()).doc_tax_rate) || 0;
  return sendMessage(chatId, "🧾 ¿Impuesto de ventas?", {
    reply_markup: keyboard([[{ text: `Con impuesto (${rate}%)`, callback_data: `dsale:tax|${rate}` }], [{ text: "Sin impuesto (dealer o fuera de Florida)", callback_data: "dsale:tax|0" }]]),
  });
}

async function askMethod(chatId: number, f: SaleFlow) {
  f.step = "method";
  await saveFlow(chatId, f);
  return sendMessage(chatId, "💳 ¿Cómo pagó?", { reply_markup: keyboard(pairs(methodButtons("dsale:pm|"))) });
}

async function summary(chatId: number, f: SaleFlow) {
  f.step = "confirm";
  await saveFlow(chatId, f);
  const t = docTotals({ items: [{ title: "", qty: 1, price: f.price ?? 0 }], discount: 0, tax_rate: f.tax ?? 0, shipping: 0 });
  return sendMessage(
    chatId,
    [`🧾 <b>Revisa la venta</b>`, "", `⌚ ${h(f.title)}`, `👤 ${h(f.name ?? "")}${f.phone ? ` · ${h(f.phone)}` : ""}`, `💵 ${usd(t.subtotal)}${t.tax ? ` + impuesto ${usd(t.tax)} = <b>${usd(t.total)}</b>` : " · sin impuesto"}`, `💳 ${h(f.method ?? "")}`, `🌐 Factura en ${f.lang === "es" ? "español" : "inglés"}`].join("\n"),
    {
      reply_markup: keyboard([
        [{ text: "✅ Registrar venta y factura", callback_data: "dsale:ok|1" }],
        [{ text: f.lang === "es" ? "🇺🇸 En inglés" : "🇪🇸 En español", callback_data: `dsale:lang|${f.lang === "es" ? "en" : "es"}` }, { text: "❌ Cancelar", callback_data: "dsale:no|1" }],
      ]),
    }
  );
}

// «25000», «25k», «$25,000» → 25000
const amount = (t: string) => {
  const m = t.toLowerCase().replace(/[$\s]/g, "").match(/^(\d+(?:[.,]\d+)*)(k)?$/);
  if (!m) return null;
  const n = Number(m[2] ? m[1].replace(",", ".") : m[1].replace(/[.,](?=\d{3}\b)/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.round((m[2] ? n * 1000 : n) * 100) / 100 : null;
};

// Respuestas de texto. Devuelve false si no hay ninguna venta a medias.
export async function onSaleText(chatId: number, text: string) {
  const f = await getFlow(chatId);
  if (!f) return false;
  if (f.step === "client") {
    const phoneRaw = text.match(/\+?\d[\d\s().-]{6,}\d/)?.[0] ?? null;
    const name = text.replace(phoneRaw ?? "", "").replace(/[,;·|]+/g, " ").replace(/\s+/g, " ").trim() || null;
    const phone = normalizePhone(phoneRaw);
    if (!name && !phone) return sendMessage(chatId, "Escribe al menos el nombre del comprador.").then(() => true);
    f.name = name;
    f.phone = phone;
    await saveFlow(chatId, f);
    const filters = [phone && `phone.ilike.%${phone.replace(/\D/g, "").slice(-7)}%`, name && name.length > 2 && `name.ilike.%${name.replace(/[,()"%]/g, "")}%`].filter(Boolean).join(",");
    const { data } = filters ? await adminDb().from("customers").select("id, name, phone").or(filters).limit(5) : { data: [] };
    if (data?.length) {
      const rows: InlineButton[][] = data.map((c) => [{ text: `👤 ${c.name ?? "Sin nombre"}${c.phone ? ` · ${c.phone}` : ""}`.slice(0, 60), callback_data: `dsale:cli|${c.id}` }]);
      rows.push([{ text: `➕ Nuevo: ${name ?? phone}`.slice(0, 60), callback_data: "dsale:cli|new" }]);
      await sendMessage(chatId, "Encontré estos clientes en el CRM. ¿Es alguno?", { reply_markup: keyboard(rows) });
      return true;
    }
    if (!name) return sendMessage(chatId, "La factura necesita el nombre del comprador. Escríbelo, por favor.").then(() => true);
    await askPrice(chatId, f);
    return true;
  }
  if (f.step === "price") {
    const n = amount(text);
    if (!n) return sendMessage(chatId, "No entendí el precio. Escribe un número, ej. <code>25000</code>.").then(() => true);
    f.price = n;
    await askTax(chatId, f);
    return true;
  }
  await sendMessage(chatId, "Usa los botones de arriba, o /cancelar para salir.");
  return true;
}

export async function onSaleCallback(chatId: number, cbId: string, messageId: number, arg: string) {
  const answer = (text?: string) => tg("answerCallbackQuery", { callback_query_id: cbId, ...(text && { text }) }).catch(() => {});
  const clearButtons = () => tg("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: keyboard([]) }).catch(() => {});
  const f = await getFlow(chatId);
  if (!f) {
    await answer("Esta venta ya no está en curso");
    return clearButtons();
  }
  await answer();
  await clearButtons();
  const [what, value] = arg.split("|");
  switch (what) {
    case "cli": {
      if (value !== "new") {
        const { data: c } = await adminDb().from("customers").select("id, name, phone").eq("id", value).single();
        f.customerId = c?.id ?? null;
        f.name = c?.name ?? f.name;
        f.phone = c?.phone ?? f.phone;
      }
      if (!f.name) {
        await saveFlow(chatId, { ...f, step: "client" });
        return sendMessage(chatId, "La factura necesita el nombre del comprador. Escríbelo, por favor.");
      }
      return askPrice(chatId, f);
    }
    case "price":
      f.price = Number(value);
      return askTax(chatId, f);
    case "tax":
      f.tax = Number(value);
      return askMethod(chatId, f);
    case "pm":
      f.method = methods[Number(value)];
      return summary(chatId, f);
    case "lang":
      f.lang = value === "es" ? "es" : "en";
      return summary(chatId, f);
    case "no":
      await clearSale(chatId);
      return sendMessage(chatId, "Venta cancelada. El reloj sigue disponible.");
    case "paid": {
      // Ya tenía factura abierta: se cobra esa
      const open = await openInvoiceFor(f.itemId);
      await clearSale(chatId);
      if (!open) return sendMessage(chatId, "Esa factura ya no está abierta.");
      const paid = await payInvoice({ ...open, status: "sent" }, methods[Number(value)] ?? null, todayInMiami(), f.user);
      return deliverPaid(chatId, paid.id);
    }
    case "ok": {
      await clearSale(chatId);
      await sendMessage(chatId, "⏳ Registrando la venta y creando la factura…");
      try {
        const paid = await sellViaInvoice(
          f.itemId,
          { price: f.price ?? 0, date: todayInMiami(), method: f.method ?? null, customerId: f.customerId ?? null, clientName: f.name ?? null, clientPhone: f.phone ?? null, taxRate: f.tax ?? 0, soldBy: f.user, lang: f.lang },
          f.user
        );
        return deliverPaid(chatId, paid.id);
      } catch (e) {
        return sendMessage(chatId, `⚠️ No se pudo registrar la venta: ${h((e as Error).message.slice(0, 200))}`);
      }
    }
  }
}
