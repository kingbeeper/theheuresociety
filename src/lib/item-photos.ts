import "server-only";
import { adminDb } from "./supabase";
import { downloadPrivate, privateUrl } from "./private-files";

// Fotos de una pieza para dejar constancia del estado en que se recibió: las de entrada (Telegram), las de
// su ficha en la web y el recorte del estuche, las fotos que mandó el cliente con su oferta y las de su ficha
// de inspección. Las privadas van con el prefijo «private:».

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://theheuresociety.vercel.app").replace(/\/$/, "");

export async function itemPhotos(itemIds: (string | null | undefined)[]) {
  const ids = itemIds.filter(Boolean) as string[];
  if (!ids.length) return [];
  const db = adminDb();
  const { data: items } = await db.from("inventory_items").select("id, photos, watch_id, sell_request_id").in("id", ids);
  const out: string[] = [];
  const add = (p: string | null | undefined) => p && !out.includes(p) && out.push(p);
  for (const i of items ?? []) {
    for (const p of (i.photos ?? []) as string[]) add(p);
    if (i.watch_id) {
      const [{ data: w }, { data: drafts }] = await Promise.all([
        db.from("watches").select("images, cutout").eq("id", i.watch_id).maybeSingle(),
        db.from("bot_drafts").select("id").eq("watch_id", i.watch_id),
      ]);
      // Fotos originales de Telegram (antes del recorte), luego las de la web y el estuche
      if (drafts?.length) {
        const { data: ph } = await db.from("bot_draft_photos").select("url").in("draft_id", drafts.map((d) => d.id)).order("tg_message");
        for (const p of ph ?? []) add(p.url as string);
      }
      for (const p of ((w?.images ?? []) as string[])) add(p);
      add(w?.cutout as string | null);
    }
    if (i.sell_request_id) {
      const { data: sr } = await db.from("sell_requests").select("image_paths").eq("id", i.sell_request_id).maybeSingle();
      for (const p of ((sr?.image_paths ?? []) as string[])) add(p);
    }
  }
  // Fichas de inspección de estas piezas (fotos privadas)
  const { data: insp } = await db.from("documents").select("items, inspection").eq("kind", "inspection").neq("status", "void");
  for (const d of insp ?? []) {
    if (!((d.items ?? []) as { item_id?: string }[]).some((l) => l.item_id && ids.includes(l.item_id))) continue;
    for (const p of ((d.inspection as { photos?: string[] } | null)?.photos ?? [])) add(`private:${p}`);
  }
  return out.slice(0, 30);
}

// Enlace para ver una foto (las privadas, con enlace firmado de 1 minuto)
export async function photoLink(p: string) {
  if (p.startsWith("private:")) return privateUrl(p.slice(8), 60);
  return p.startsWith("http") ? p : `${SITE}${p.startsWith("/") ? "" : "/"}${p}`;
}

// Bytes de una foto (para incrustarla en el PDF)
export async function photoBytes(p: string) {
  if (p.startsWith("private:")) return downloadPrivate(p.slice(8));
  const res = await fetch(await photoLink(p) as string, { signal: AbortSignal.timeout(15_000) }).catch(() => null);
  return res?.ok ? new Uint8Array(await res.arrayBuffer()) : null;
}
