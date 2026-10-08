import type { Metadata } from "next";
import type { Locale } from "./i18n";
import { contact } from "./site";

// Utilidades de SEO compartidas por todas las páginas: URL canónica, versiones por idioma,
// vista previa al compartir (Open Graph) y datos estructurados (schema.org).

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://theheuresociety.com").replace(/\/$/, "");
export const SITE_NAME = "The Heure Society";

// Imagen para compartir en WhatsApp, Instagram, etc. (1200×630)
const ogImage = (lang: Locale) => ({ url: `/og-${lang}.jpg`, width: 1200, height: 630, alt: SITE_NAME });

// `path` es la ruta sin idioma: "" (portada), "/watches", "/watches/rolex-…"
export function pageMetadata(
  lang: Locale,
  path: string,
  { title, description, images }: { title: string; description: string; images?: string[] }
): Metadata {
  return {
    title,
    description,
    alternates: {
      canonical: `/${lang}${path}`,
      // Inglés por defecto para quien no habla ninguno de los dos idiomas
      languages: { en: `/en${path}`, es: `/es${path}`, "x-default": `/en${path}` },
    },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      locale: lang === "es" ? "es_US" : "en_US",
      alternateLocale: lang === "es" ? "en_US" : "es_US",
      url: `/${lang}${path}`,
      title,
      description,
      images: images?.length ? images : [ogImage(lang)],
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

// El negocio (tienda de relojes con oficina en Miami): va en todas las páginas
export function storeJsonLd(lang: Locale) {
  const a = contact.address;
  return {
    "@context": "https://schema.org",
    "@type": "JewelryStore",
    "@id": `${SITE_URL}/#store`,
    name: SITE_NAME,
    url: `${SITE_URL}/${lang}`,
    logo: `${SITE_URL}/icon.png`,
    image: `${SITE_URL}/og-${lang}.jpg`,
    telephone: contact.phoneE164,
    priceRange: "$$$$",
    address: {
      "@type": "PostalAddress",
      streetAddress: a.street,
      addressLocality: a.city,
      addressRegion: a.region,
      postalCode: a.postalCode,
      addressCountry: a.country,
    },
    hasMap: contact.mapsUrl,
    areaServed: "Miami",
    openingHoursSpecification: contact.openingHours.map((h) => ({
      "@type": "OpeningHoursSpecification",
      dayOfWeek: h.days,
      opens: h.opens,
      closes: h.closes,
    })),
    sameAs: [contact.instagram],
  };
}

// Migas de pan para Google: [nombre, ruta sin idioma]
export function breadcrumbJsonLd(lang: Locale, items: [string, string][]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map(([name, path], i) => ({
      "@type": "ListItem",
      position: i + 1,
      name,
      item: `${SITE_URL}/${lang}${path}`,
    })),
  };
}

export function JsonLd({ data }: { data: object }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />;
}
