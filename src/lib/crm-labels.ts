// Etiquetas del CRM (se usan en el servidor y en el navegador)

export const STAGES = ["new", "contacted", "qualified", "appointment", "negotiating", "won", "lost"] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABEL: Record<Stage, string> = {
  new: "Nuevo",
  contacted: "Contactado",
  qualified: "Cualificado",
  appointment: "Cita",
  negotiating: "Negociando",
  won: "Ganado",
  lost: "Perdido",
};

export const SOURCE_LABEL: Record<string, string> = {
  whatsapp: "WhatsApp",
  web_booking: "Web · cita",
  web_sell: "Web · vender",
  web_consign: "Web · consignar",
  web_alert: "Web · aviso",
  instagram: "Instagram",
  facebook: "Facebook",
  referral: "Recomendación",
  walk_in: "En persona",
  other: "Otro",
};

export const INTENT_LABEL: Record<string, string> = { buy: "Comprar", sell: "Vender", consign: "Consignar", trade: "Intercambiar" };

// Etiquetas rápidas de cliente (además de las que se escriban a mano en su ficha)
export const CUSTOMER_TAGS = ["VIP", "Dealer", "Coleccionista", "Mayorista", "Inversor"] as const;
export const hasTag = (tags: string[] | null | undefined, tag: string) => (tags ?? []).some((t) => t.toLowerCase() === tag.toLowerCase());
