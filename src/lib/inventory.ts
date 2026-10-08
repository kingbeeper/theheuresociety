import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import seed from "@/data/watches-seed.json";
import { publicDb, supabaseConfigured } from "./supabase";
import type { Localized, Watch, WatchStatus } from "./watches";

// Etiqueta de caché: el robot la invalida al publicar para que la web se actualice
export const INVENTORY_TAG = "watches";

type WatchRow = {
  slug: string;
  status: WatchStatus | "draft";
  brand: string;
  model: string;
  reference: string;
  year: number | null;
  has_box: boolean;
  has_papers: boolean;
  price: number | string | null;
  currency: string;
  case_size: string;
  material: Localized;
  dial: Localized | null;
  bracelet: Localized | null;
  description: Localized | null;
  movement: string | null;
  power_reserve: string | null;
  water_resistance: string | null;
  images: string[];
  cutout?: string | null;
};

export function fromRow(r: WatchRow): Watch {
  return {
    slug: r.slug,
    status: r.status === "draft" ? "available" : r.status,
    brand: r.brand,
    model: r.model,
    reference: r.reference,
    year: r.year ?? undefined,
    hasBox: r.has_box,
    hasPapers: r.has_papers,
    price: r.price == null ? undefined : Number(r.price),
    currency: r.currency,
    caseSize: r.case_size,
    material: r.material,
    dial: r.dial ?? undefined,
    bracelet: r.bracelet ?? undefined,
    description: r.description ?? undefined,
    movement: r.movement ?? undefined,
    powerReserve: r.power_reserve ?? undefined,
    waterResistance: r.water_resistance ?? undefined,
    images: r.images ?? [],
    cutout: r.cutout ?? undefined,
  };
}

// Todos los relojes publicados, del más reciente al más antiguo
export async function getWatches(): Promise<Watch[]> {
  "use cache";
  cacheTag(INVENTORY_TAG);
  cacheLife("hours");

  if (!supabaseConfigured) return seed as Watch[];

  const { data, error } = await publicDb()
    .from("watches")
    .select("*")
    .in("status", ["available", "reserved", "sold"])
    .order("published_at", { ascending: false, nullsFirst: false });

  if (error) {
    console.error("No se pudo leer el inventario de Supabase:", error.message);
    return seed as Watch[];
  }
  return (data as WatchRow[]).map(fromRow);
}

export async function getWatch(slug: string) {
  return (await getWatches()).find((w) => w.slug === slug);
}

export async function getBrands() {
  return [...new Set((await getWatches()).map((w) => w.brand))].sort();
}
