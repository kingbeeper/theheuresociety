// Datos de ejemplo hasta conectar Supabase (fase 3).
// La forma coincide con la tabla `watches` de supabase/schema.sql.

export type WatchStatus = "available" | "reserved" | "sold";
type Localized = { en: string; es: string };

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
  images: string[]; // rutas en /public/watches; vacío = se muestra el monograma
  // Ficha técnica (se muestran solo los campos presentes)
  dial?: Localized;
  bracelet?: Localized;
  movement?: string;
  powerReserve?: string;
  waterResistance?: string;
  description?: Localized;
};

export const watches: Watch[] = [
  {
    slug: "rolex-daytona-126519ln-meteorite",
    status: "available",
    brand: "Rolex",
    model: "Cosmograph Daytona",
    reference: "126519LN",
    hasBox: true,
    hasPapers: true,
    currency: "USD",
    caseSize: "40 mm",
    material: { en: "18k white gold", es: "Oro blanco 18k" },
    dial: { en: "Meteorite, black sub-dials", es: "Meteorito, subesferas negras" },
    bracelet: { en: "Oysterflex", es: "Oysterflex" },
    movement: "Rolex 4131",
    powerReserve: "72 h",
    waterResistance: "100 m",
    images: ["/watches/rolex-daytona-126519ln-box.jpg", "/watches/rolex-daytona-126519ln.jpg"],
    description: {
      en: "The Cosmograph Daytona in 18k white gold, paired with a meteorite dial — each one cut from a real meteorite, so no two are alike. Black sub-dials and a black Cerachrom bezel give it a sharp, high-contrast read, while the Oysterflex bracelet keeps it light and comfortable. Powered by calibre 4131. Complete with box and warranty card.",
      es: "El Cosmograph Daytona en oro blanco de 18k con esfera de meteorito: cada esfera se corta de un meteorito real, así que no hay dos iguales. Las subesferas negras y el bisel Cerachrom negro le dan un contraste nítido, y el brazalete Oysterflex lo mantiene ligero y cómodo. Calibre 4131. Completo con caja y tarjeta de garantía.",
    },
  },
  {
    slug: "audemars-piguet-royal-oak-chronograph-26240st-green",
    status: "available",
    brand: "Audemars Piguet",
    model: "Royal Oak Chronograph",
    reference: "26240ST",
    hasBox: true,
    hasPapers: true,
    currency: "USD",
    caseSize: "41 mm",
    material: { en: "Stainless steel", es: "Acero inoxidable" },
    dial: { en: "Green “Grande Tapisserie”", es: "Verde “Grande Tapisserie”" },
    bracelet: { en: "Integrated steel bracelet", es: "Brazalete integrado de acero" },
    movement: "Audemars Piguet 4401",
    powerReserve: "70 h",
    waterResistance: "50 m",
    images: ["/watches/ap-royal-oak-chronograph-26240st.jpg"],
    description: {
      en: "The current-generation Royal Oak Chronograph in steel, with a green “Grande Tapisserie” dial and tone-on-tone sub-dials. The octagonal bezel, eight hexagonal screws and integrated bracelet are finished with the alternating brushed and polished surfaces Audemars Piguet is known for. In-house column-wheel calibre 4401 with flyback function.",
      es: "El Royal Oak Chronograph de generación actual en acero, con esfera verde “Grande Tapisserie” y subesferas a juego. El bisel octogonal, sus ocho tornillos hexagonales y el brazalete integrado alternan superficies satinadas y pulidas, el sello de Audemars Piguet. Calibre de manufactura 4401 con rueda de pilares y función flyback.",
    },
  },
  {
    slug: "rolex-land-dweller-127235",
    status: "available",
    brand: "Rolex",
    model: "Land-Dweller 40",
    reference: "127235",
    hasBox: true,
    hasPapers: true,
    currency: "USD",
    caseSize: "40 mm",
    material: { en: "18k Everose gold", es: "Oro Everose 18k" },
    dial: { en: "White, honeycomb motif", es: "Blanca, motivo de panal" },
    bracelet: { en: "Flat Jubilee, integrated", es: "Flat Jubilee integrado" },
    movement: "Rolex 7135",
    powerReserve: "66 h",
    waterResistance: "100 m",
    images: ["/watches/rolex-land-dweller-127235.jpg"],
    description: {
      en: "Rolex's newest collection, in 18k Everose gold. The Land-Dweller pairs a fluted bezel with an integrated Flat Jubilee bracelet, and a white dial engraved with a honeycomb pattern. Inside is calibre 7135 with the Dynapulse escapement, beating at 5 Hz — a first for Rolex.",
      es: "La colección más reciente de Rolex, en oro Everose de 18k. El Land-Dweller combina un bisel estriado con un brazalete Flat Jubilee integrado y una esfera blanca grabada con motivo de panal. En su interior, el calibre 7135 con escape Dynapulse que late a 5 Hz, una novedad en Rolex.",
    },
  },
  {
    slug: "audemars-piguet-royal-oak-offshore",
    status: "available",
    brand: "Audemars Piguet",
    model: "Royal Oak Offshore Chronograph",
    reference: "26420SO.OO.A600CA.01",
    hasBox: true,
    hasPapers: true,
    price: 100000,
    currency: "USD",
    caseSize: "43 mm",
    material: { en: "Steel & ceramic", es: "Acero y cerámica" },
    movement: "Audemars Piguet 4401",
    waterResistance: "100 m",
    images: [],
  },
  {
    slug: "rolex-yacht-master-40-everose",
    status: "available",
    brand: "Rolex",
    model: "Yacht-Master 40",
    reference: "126711CHNR",
    hasBox: true,
    hasPapers: true,
    price: 19500,
    currency: "USD",
    caseSize: "40 mm",
    material: { en: "Everose Rolesor", es: "Everose Rolesor" },
    images: [],
  },
  {
    slug: "rolex-sky-dweller-336934",
    status: "available",
    brand: "Rolex",
    model: "Sky-Dweller",
    reference: "336934",
    hasBox: true,
    hasPapers: true,
    price: 18800,
    currency: "USD",
    caseSize: "42 mm",
    material: { en: "Oystersteel & white gold", es: "Acero Oystersteel y oro blanco" },
    movement: "Rolex 9002",
    powerReserve: "72 h",
    waterResistance: "100 m",
    images: [],
  },
  {
    slug: "cartier-ballon-bleu",
    status: "reserved",
    brand: "Cartier",
    model: "Ballon Bleu",
    reference: "WSBB0040",
    hasBox: true,
    hasPapers: false,
    price: 22000,
    currency: "USD",
    caseSize: "42 mm",
    material: { en: "Steel", es: "Acero" },
    images: [],
  },
  {
    slug: "rolex-datejust-36",
    status: "available",
    brand: "Rolex",
    model: "Datejust 36",
    reference: "126233",
    hasBox: true,
    hasPapers: true,
    price: 17500,
    currency: "USD",
    caseSize: "36 mm",
    material: { en: "Yellow Rolesor", es: "Rolesor amarillo" },
    movement: "Rolex 3235",
    powerReserve: "70 h",
    waterResistance: "100 m",
    images: [],
  },
  {
    slug: "rolex-lady-datejust-26-silver",
    status: "available",
    brand: "Rolex",
    model: "Lady-Datejust 26",
    reference: "179174",
    hasBox: false,
    hasPapers: false,
    price: 8500,
    currency: "USD",
    caseSize: "26 mm",
    material: { en: "White Rolesor", es: "Rolesor blanco" },
    images: [],
  },
];

export const getWatch = (slug: string) => watches.find((w) => w.slug === slug);

export const brands = [...new Set(watches.map((w) => w.brand))].sort();

export function formatPrice(watch: Watch, locale: string) {
  if (watch.price == null) return locale === "es" ? "Precio a consultar" : "Price on request";
  return new Intl.NumberFormat(locale === "es" ? "es-US" : "en-US", {
    style: "currency",
    currency: watch.currency,
    maximumFractionDigits: 0,
  }).format(watch.price);
}

// Enlace de WhatsApp con el mensaje ya escrito. El número se configura en .env.local
export function whatsappLink(message: string) {
  const number = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? "";
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}
