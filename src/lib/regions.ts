// Regiones de clientes, para enviar ofertas y correos a cada zona. Si la ficha no tiene región, se
// sugiere por la dirección (de la ficha o de sus documentos) o por el código de área del teléfono.

export const REGIONS = {
  miami: "🌴 Sur de Florida",
  orlando: "🏰 Orlando",
  pr: "🇵🇷 Puerto Rico",
  rd: "🇩🇴 República Dominicana",
  ny: "🗽 New York",
  boston: "🦞 Boston",
  otra: "🌎 Otra",
} as const;
export type Region = keyof typeof REGIONS;
export const isRegion = (r: unknown): r is Region => typeof r === "string" && r in REGIONS;

const AREA: Record<string, Region> = {};
const area = (r: Region, codes: string) => codes.split(" ").forEach((c) => (AREA[c] = r));
area("miami", "305 786 954 754 561 239 772");
area("orlando", "407 321 689 352 863");
area("pr", "787 939");
area("rd", "809 829 849");
area("ny", "212 646 332 917 718 347 929 516 631 914 845 934");
area("boston", "617 857 781 339 508 774 978 351");

const BY_ADDRESS: [Region, RegExp][] = [
  ["rd", /dominican|rep[uú]blica dominicana|santo domingo|santiago de los caballeros|punta cana|la romana|\bRD\b/i],
  ["pr", /puerto rico|san juan|bayam[oó]n|carolina,|guaynabo|ponce|dorado|\bPR\s*00\d{3}\b/i],
  ["orlando", /orlando|kissimmee|winter park|lake mary|windermere|sanford|\bFL\s*3(2[78]|47)\d{2}\b/i],
  ["boston", /boston|massachusetts|cambridge,|brookline|newton,|\bMA\s*0[12]\d{3}\b/i],
  ["ny", /new york|brooklyn|bronx|queens|manhattan|staten island|long island|\bNY\s*1[0-4]\d{3}\b/i],
  ["miami", /miami|fort lauderdale|ft\.? lauderdale|doral|coral gables|aventura|hialeah|boca raton|key biscayne|hollywood,|weston|\bFL\b/i],
];

export function guessRegion(phone: string | null | undefined, address?: string | null): Region | null {
  for (const [r, re] of BY_ADDRESS) if (address && re.test(address)) return r;
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return AREA[digits.slice(1, 4)] ?? null;
  if (digits.length === 10 && !(phone ?? "").trim().startsWith("+")) return AREA[digits.slice(0, 3)] ?? null;
  return null;
}

// Región de un cliente: la guardada o la sugerida
export const regionOf = (c: { region?: string | null; phone?: string | null }, address?: string | null) =>
  isRegion(c.region) ? { region: c.region, guessed: false } : { region: guessRegion(c.phone, address), guessed: true };
