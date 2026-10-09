import "server-only";
import { adminDb } from "./supabase";
import { daysInStock, logItem, syncWebPrice, type Item } from "./stock";
import { notifyPriceDrop } from "./crm";
import { escapeHtml as h, keyboard, sendMessage, notifyAdmins } from "./telegram";

// Rebaja sugerida: relojes con más de 90 días en stock (y sin cambio de precio en el último mes)
// reciben una propuesta de −5 %. Al aplicarla se actualiza la web y se avisa a los interesados.

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://theheuresociety.vercel.app").replace(/\/$/, "");
const DAY = 86_400_000;
const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

export async function suggestedDrops(now = Date.now(), limit = 3) {
  const db = adminDb();
  const { data } = await db.from("inventory_items").select("*").eq("status", "in_stock").not("asking_price", "is", null);
  const aged = ((data ?? []) as Item[]).filter((i) => (daysInStock(i, now) ?? 0) > 90);
  if (!aged.length) return [];
  const { data: recent } = await db.from("inventory_events").select("item_id").eq("type", "price").gte("created_at", new Date(now - 30 * DAY).toISOString()).in("item_id", aged.map((i) => i.id));
  const touched = new Set((recent ?? []).map((r) => r.item_id as string));
  return aged
    .filter((i) => !touched.has(i.id))
    .sort((a, b) => (daysInStock(b, now) ?? 0) - (daysInStock(a, now) ?? 0))
    .slice(0, limit)
    .map((i) => ({ item: i, days: daysInStock(i, now) ?? 0, from: Number(i.asking_price), to: Math.floor((Number(i.asking_price) * 0.95) / 50) * 50 }));
}

const dropMessage = (s: Awaited<ReturnType<typeof suggestedDrops>>[number]) =>
  [
    `🏷 <b>${h(s.item.sku)} ${h(s.item.brand)} ${h(s.item.model ?? "")}</b> lleva ${s.days} días en stock.`,
    `Precio ${usd(s.from)} → propuesta <b>${usd(s.to)}</b> (−5 %)`,
    s.item.cost != null ? `<i>Costo total ${usd(Number(s.item.cost) + Number(s.item.extra_costs ?? 0))}</i>` : "",
  ].filter(Boolean).join("\n");

const dropButtons = (s: Awaited<ReturnType<typeof suggestedDrops>>[number]) =>
  keyboard([[{ text: `Bajar a ${usd(s.to)}`, callback_data: `dprc:${s.item.id}|${s.to}` }, { text: "Dejarlo", callback_data: "dprc:no" }]]);

// En el resumen diario (a todos los administradores)
export async function notifyDrops() {
  for (const s of await suggestedDrops()) await notifyAdmins(dropMessage(s), { reply_markup: dropButtons(s) }).catch(() => {});
}

// Desde el menú de Telegram
export async function sendDrops(chatId: number) {
  const list = await suggestedDrops(Date.now(), 8);
  if (!list.length) return sendMessage(chatId, "✅ No hay relojes estancados: ninguno lleva más de 90 días sin un cambio de precio.");
  for (const s of list) await sendMessage(chatId, dropMessage(s), { reply_markup: dropButtons(s) });
}

export async function applyPrice(itemId: string, price: number, user: string) {
  const db = adminDb();
  const { data: i } = await db.from("inventory_items").select("*").eq("id", itemId).single();
  if (!i) return null;
  const from = Number(i.asking_price);
  await db.from("inventory_items").update({ asking_price: price, updated_at: new Date().toISOString() }).eq("id", itemId);
  await logItem(itemId, "price", `Precio: ${usd(from)} → ${usd(price)} (rebaja sugerida)`, user);
  await syncWebPrice(i.watch_id, price);
  let notified = 0;
  if (i.watch_id && price < from) {
    const { data: w } = await db.from("watches").select("brand, model, reference, slug, status").eq("id", i.watch_id).maybeSingle();
    if (w && (w.status === "available" || w.status === "reserved")) notified = await notifyPriceDrop(w, from, price, SITE).catch(() => 0);
  }
  return { sku: i.sku as string, from, to: price, notified };
}
