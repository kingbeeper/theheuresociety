// Estuches de la colección interactiva. Cada uno es una foto cenital del estuche
// abierto y vacío, con la posición de cada cojín en % de la imagen.
// Para añadir uno (4, 6, 12 espacios…): poner la imagen en /public/cases y sus cojines aquí.

export type Slot = { x: number; y: number; w: number; h: number }; // % del ancho/alto

export type CaseLayout = {
  id: string;
  image: string;
  width: number; // px de la imagen, para la proporción
  height: number;
  slots: Slot[];
  // Cuánto puede sobresalir el brazalete por arriba y por abajo del cojín, en % de su alto,
  // sin pisar el cojín vecino (depende del espacio entre filas de cada estuche)
  reach: number;
  // Ancho máximo en pantalla (px): el estuche se ve entero, como un objeto, y el
  // de 4 se percibe más pequeño que el de 12
  maxWidth: number;
};

const px = (x: number, y: number, w: number, h: number, W: number, H: number): Slot => ({
  x: (x / W) * 100,
  y: (y / H) * 100,
  w: (w / W) * 100,
  h: (h / H) * 100,
});

// Diseños basados en el estuche real del cliente (cuero verde grabado tipo cocodrilo,
// interior y cojines de ante verde), generados en Higgsfield con vista cenital.
// Coordenadas medidas en la imagen original; `crop` es el recorte aplicado (izq., arriba, ancho, alto)
const grid = (crop: [number, number, number, number], xs: number[], ys: number[], w: number, h: number) =>
  ys.flatMap((y) => xs.map((x) => px(x - crop[0], y - crop[1], w, h, crop[2], crop[3])));

const CASE_4: CaseLayout = {
  id: "case-4",
  image: "/cases/case-4.jpg",
  width: 2436,
  height: 944,
  slots: grid([127, 94, 2436, 944], [375, 893, 1417, 1937], [308], 375, 520),
  reach: 7,
  maxWidth: 880,
};

// El 6 y el 12 repiten los cojines altos del 4 (misma forma y separación), y su ancho máximo
// hace que cada cojín mida en pantalla lo mismo que en el de 4: los relojes se ven igual en todos
const CASE_6: CaseLayout = {
  id: "case-6",
  image: "/cases/case-6.jpg",
  width: 2240,
  height: 1792,
  slots: grid([0, 0, 2240, 1792], [286, 903, 1520], [233, 1038], 430, 538),
  reach: 7,
  maxWidth: 706,
};

const CASE_12: CaseLayout = {
  id: "case-12",
  image: "/cases/case-12.jpg",
  width: 2048,
  height: 2048,
  slots: grid([0, 0, 2048, 2048], [200, 649, 1094, 1539], [202, 826, 1441], 317, 398),
  reach: 7,
  maxWidth: 875,
};

export const CASES: CaseLayout[] = [CASE_4, CASE_6, CASE_12];

// Elige el estuche más pequeño donde caben todos; si no cabe en ninguno,
// reparte el inventario en varios estuches del tamaño mayor.
export function packIntoCases<T>(items: T[], cases: CaseLayout[] = CASES): { layout: CaseLayout; items: T[] }[] {
  if (!items.length) return [];
  const sorted = [...cases].sort((a, b) => a.slots.length - b.slots.length);
  const fit = sorted.find((c) => c.slots.length >= items.length);
  if (fit) return [{ layout: fit, items }];

  const largest = sorted[sorted.length - 1];
  const out: { layout: CaseLayout; items: T[] }[] = [];
  for (let i = 0; i < items.length; i += largest.slots.length) {
    const chunk = items.slice(i, i + largest.slots.length);
    // El último estuche usa el tamaño justo para lo que queda
    const last = sorted.find((c) => c.slots.length >= chunk.length) ?? largest;
    out.push({ layout: last, items: chunk });
  }
  return out;
}
