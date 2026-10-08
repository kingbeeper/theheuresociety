import type { MetadataRoute } from "next";
import { getWatches } from "@/lib/inventory";
import { SITE_URL } from "@/lib/seo";

// Mapa del sitio para Google: páginas fijas y cada reloj, en los dos idiomas.
// Usa el mismo inventario en caché que la web, así que un reloj publicado por Telegram aparece solo.
const PAGES = ["", "/watches", "/appointments", "/sell", "/consign", "/contact"];

const entry = (path: string, extra: Partial<MetadataRoute.Sitemap[number]> = {}): MetadataRoute.Sitemap =>
  (["es", "en"] as const).map((lang) => ({
    url: `${SITE_URL}/${lang}${path}`,
    alternates: { languages: { en: `${SITE_URL}/en${path}`, es: `${SITE_URL}/es${path}` } },
    ...extra,
  }));

const absolute = (src: string) => (src.startsWith("http") ? src : `${SITE_URL}${src}`);

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const watches = await getWatches();
  return [
    ...PAGES.flatMap((path) => entry(path, { changeFrequency: path === "/watches" || path === "" ? "daily" : "monthly", priority: path === "" ? 1 : 0.7 })),
    ...watches.flatMap((w) =>
      entry(`/watches/${w.slug}`, {
        changeFrequency: "weekly",
        priority: w.status === "sold" ? 0.3 : 0.8,
        images: w.images.map(absolute),
      })
    ),
  ];
}
