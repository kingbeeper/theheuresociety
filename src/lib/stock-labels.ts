// Etiquetas del inventario (servidor y navegador)

export const ITEM_STATUS = { in_stock: "En stock", reserved: "Reservado", sold: "Vendido", returned: "Devuelto" } as const;
export type ItemStatus = keyof typeof ITEM_STATUS;

export const ACQUISITION = { purchase: "Compra", trade: "Intercambio", consignment: "Consignación", memo: "Memo de dealer" } as const;
export type Acquisition = keyof typeof ACQUISITION;

export const PAYMENT = { wire: "Transferencia", zelle: "Zelle", cash: "Efectivo", card: "Tarjeta", crypto: "Cripto", trade: "Intercambio", other: "Otro" } as const;

export const CONDITIONS = ["New", "Unworn", "Pre-Owned", "Excellent", "Very good", "Good", "Fair"];

// Consignación y memo: el reloj no es nuestro; al venderlo se paga al dueño (cost)
export const isOwnerStock = (a: string) => a === "consignment" || a === "memo";

// Tipo de pieza: los relojes son el centro (serial, tarjeta, precio de mercado, web); las joyas y lo demás
// van por su lado con sus propios datos
export const CATEGORY = { watch: "Reloj", jewelry: "Joya", other: "Otro" } as const;
export type Category = keyof typeof CATEGORY;

export const JEWELRY_TYPE = { ring: "Anillo", engagement: "Anillo de compromiso", chain: "Cadena", earrings: "Aretes", bracelet: "Pulsera", pendant: "Dije", other: "Otra joya" } as const;
export type JewelryType = keyof typeof JEWELRY_TYPE;
export const METALS = ["Oro 10k", "Oro 14k", "Oro 18k", "Platino", "Plata 925", "Acero"];
export const GOLD_COLORS = ["Amarillo", "Blanco", "Rosa", "Dos tonos"];

export type Jewelry = {
  type: JewelryType;
  metal: string | null;
  color: string | null;
  stone: string | null; // diamante, esmeralda…
  carats: string | null; // quilates de la piedra principal o total
  quality: string | null; // color y pureza (G/VS1…) o certificado (GIA…)
  size: string | null; // talla del anillo, largo de la cadena…
  weight: string | null; // gramos
};

// «Oro 18k amarillo · Diamante 1.02 ct (G/VS1) · talla 6 · 4.2 g»
export function jewelrySummary(j: Partial<Jewelry> | null | undefined) {
  if (!j) return "";
  return [
    [j.metal, j.color?.toLowerCase()].filter(Boolean).join(" "),
    // Quilates: si ya traen «ct» escrito no se repite («1ct», «1,02 CT»)
    j.stone ? `${j.stone}${j.carats ? ` ${String(j.carats).trim().replace(/\s*ct\.?$/i, "")} ct` : ""}${j.quality ? ` (${j.quality})` : ""}` : "",
    j.size ? (j.type === "chain" || j.type === "bracelet" ? `${j.size}` : `talla ${j.size}`) : "",
    j.weight ? `${j.weight} g` : "",
  ].filter(Boolean).join(" · ");
}

// Línea debajo del nombre en cotizaciones, proformas y facturas: en una joya, metal, piedra, quilates,
// calidad, talla y peso; en un reloj, estado, papeles y lo que incluye. Y la descripción de la ficha.
export function lineDetails(i: { category?: string | null; jewelry?: Partial<Jewelry> | null; condition?: string | null; papers_date?: string | null; comes_with?: string | null; description?: string | null }) {
  const parts =
    i.category === "jewelry"
      ? [jewelrySummary(i.jewelry), i.condition, i.comes_with]
      : [i.condition, i.papers_date ? `Papers ${String(i.papers_date).slice(0, 7)}` : null, i.comes_with];
  const line = parts.filter(Boolean).join(" · ");
  const desc = i.description?.trim();
  return [line, desc].filter(Boolean).join(" · ") || null;
}
