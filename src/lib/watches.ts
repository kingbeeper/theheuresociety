import { contact } from "./site";

// Tipos y utilidades del inventario que también se usan en el navegador.
// La lectura de datos (Supabase o respaldo local) está en ./inventory.ts.

export type WatchStatus = "available" | "reserved" | "sold";
export type Localized = { en: string; es: string };

export type Watch = {
  slug: string;
  status: WatchStatus;
  brand: string;
  model: string;
  reference: string;
  year?: number;
  hasBox: boolean;
  hasPapers: boolean;
  price?: number; // sin precio se muestra "Precio a consultar"
  currency: string;
  caseSize: string;
  material: Localized;
  images: string[]; // rutas locales o URLs públicas; vacío = se muestra el monograma
  // Ficha técnica (se muestran solo los campos presentes)
  dial?: Localized;
  bracelet?: Localized;
  movement?: string;
  powerReserve?: string;
  waterResistance?: string;
  description?: Localized;
};

export function formatPrice(watch: Watch, locale: string) {
  if (watch.price == null) return locale === "es" ? "Precio a consultar" : "Price on request";
  return new Intl.NumberFormat(locale === "es" ? "es-US" : "en-US", {
    style: "currency",
    currency: watch.currency,
    maximumFractionDigits: 0,
  }).format(watch.price);
}

// Enlace de WhatsApp con el mensaje ya escrito. El número sale de src/lib/site.ts
// (NEXT_PUBLIC_WHATSAPP_NUMBER, si existe, tiene prioridad)
export function whatsappLink(message: string) {
  const number = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || contact.whatsapp;
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

// "Rolex Cosmograph Daytona 126519LN" -> "rolex-cosmograph-daytona-126519ln"
export function toSlug(...parts: string[]) {
  return parts
    .join(" ")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
