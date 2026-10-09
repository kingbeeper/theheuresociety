// Dónde está cada reloj (servidor y navegador). «En memo» y «En el relojero» se deducen solos.
export const LOCATIONS = {
  safe: "Caja fuerte",
  showcase: "Vitrina",
  office: "Oficina",
  client: "Con un cliente (cita)",
  other: "Otro",
} as const;
export type Location = keyof typeof LOCATIONS;
