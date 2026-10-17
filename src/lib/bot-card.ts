import "server-only";
import sharp from "sharp";
import { adminDb } from "./supabase";
import { readWarrantyCard } from "./warranty-card";
import { serialHistory } from "./serials";
import { downloadFile, escapeHtml as h, keyboard, sendMessage } from "./telegram";

// 🪪 Leer la tarjeta de garantía por Telegram: foto → marca, referencia, serial y fecha → botón para abrir
// el alta del reloj en el CRM con todo relleno (y aviso si ese serial ya pasó por el sistema).

const key = (chatId: number) => `tgcard:${chatId}`;
const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://theheuresociety.vercel.app").replace(/\/$/, "");

export async function cardPending(chatId: number) {
  const { data } = await adminDb().from("integration_settings").select("key").eq("key", key(chatId)).maybeSingle();
  return Boolean(data);
}
export const clearCard = (chatId: number) => adminDb().from("integration_settings").delete().eq("key", key(chatId));

export async function startCard(chatId: number) {
  await adminDb().from("integration_settings").upsert({ key: key(chatId), value: "1", updated_at: new Date().toISOString() }, { onConflict: "key" });
  return sendMessage(chatId, "🪪 <b>Leer tarjeta de garantía</b>\nEnvíame una foto de la tarjeta (o de los papeles), de frente y sin reflejos.", {
    reply_markup: keyboard([[{ text: "✖️ Cancelar", callback_data: "dcard:x" }]]),
  });
}

export async function onCardPhoto(chatId: number, fileId: string) {
  await clearCard(chatId);
  await sendMessage(chatId, "🔎 Leyendo la tarjeta…");
  try {
    const raw = Buffer.from(await downloadFile(fileId));
    const jpg = await sharp(raw).rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
    const c = await readWarrantyCard({ base64: jpg.toString("base64"), mediaType: "image/jpeg" });
    if (!c || (!c.brand && !c.reference && !c.serial)) return sendMessage(chatId, "No pude leer la tarjeta. Prueba con otra foto, de frente y con buena luz.");
    const seen = c.serial ? await serialHistory(c.serial, { showSuppliers: true }).catch(() => []) : [];
    const params = new URLSearchParams(
      Object.entries({ marca: c.brand, modelo: c.model, ref: c.reference, serial: c.serial, papeles: c.papers_date && /^\d{4}-\d{2}-\d{2}$/.test(c.papers_date) ? c.papers_date : null }).filter(([, v]) => v) as [string, string][]
    );
    return sendMessage(
      chatId,
      [
        `🪪 <b>${h([c.brand, c.model, c.reference].filter(Boolean).join(" ") || "Reloj")}</b>`,
        c.serial ? `Serial: <code>${h(c.serial)}</code>` : "Serial: no se lee con seguridad",
        c.papers_date ? `Papeles: ${h(c.papers_date)}` : "",
        c.retailer ? `Distribuidor: ${h(c.retailer)}` : "",
        c.doubtful.length ? `⚠️ Revisa a mano: ${h(c.doubtful.join(", "))}` : "",
        seen.length ? `\n⚠️ <b>Este serial ya pasó por el sistema</b> (${seen.length} registro(s)): míralo en el CRM antes de comprarlo.` : "",
      ].filter(Boolean).join("\n"),
      { reply_markup: keyboard([[{ text: "➕ Dar de alta en el inventario", url: `${SITE}/admin/inventario/nuevo?${params}` }]]) }
    );
  } catch (e) {
    console.error("Tarjeta de garantía (Telegram):", e);
    return sendMessage(chatId, "No pude leer la tarjeta. Prueba con otra foto, de frente y con buena luz.");
  }
}
