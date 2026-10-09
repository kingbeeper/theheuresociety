"use server";

import { requireAdmin } from "@/lib/admin-auth";
import { audience, defaultIntro, recentWatches, sendNewsletter } from "@/lib/newsletter";

// Envío de los correos de novedades (prueba al propio usuario, o a todos los destinatarios)
export async function sendNewsletterAction(_: unknown, f: FormData) {
  const user = await requireAdmin("correos");
  const ids = f.getAll("w").map(String);
  const watches = (await recentWatches(60)).filter((w) => ids.includes(w.id));
  if (!watches.length) return { error: "Elige al menos un reloj." };
  const subject = { en: String(f.get("subject_en") || "New arrivals · The Heure Society"), es: String(f.get("subject_es") || "Nuevas llegadas · The Heure Society") };
  const intro = { en: String(f.get("intro_en") || defaultIntro(false)), es: String(f.get("intro_es") || defaultIntro(true)) };
  const test = f.get("mode") === "test";
  try {
    if (test) {
      await sendNewsletter(watches, [{ id: "prueba", name: "Prueba", email: user, lang: "es" }, { id: "prueba-en", name: "Test", email: user, lang: "en" }], subject, intro, user);
      return { ok: `Prueba enviada a ${user} (en español y en inglés).` };
    }
    if (f.get("confirm") !== "on") return { error: "Marca la casilla de confirmación para enviar." };
    const brands = f.get("marca") === "1" ? [...new Set(watches.map((w) => w.brand))] : null;
    const people = await audience(brands);
    if (!people.length) return { error: "No hay destinatarios con estos filtros." };
    const n = await sendNewsletter(watches, people, subject, intro, user);
    return { ok: `Enviado a ${n} cliente(s).` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
