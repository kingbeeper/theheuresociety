import "server-only";
import { adminDb } from "./supabase";

// Demanda frente a inventario: qué modelos buscan los clientes (búsquedas «avísenme» y el
// «qué busca» de los leads abiertos) y cuántos hay en stock. Dice qué conviene comprar.

// Familias de modelos: por nombre o por referencia (el orden importa: Offshore antes que Royal Oak)
const FAMILIES: [string, RegExp][] = [
  ["Rolex Daytona", /daytona|\b1[12]65\d\d/],
  ["Rolex Submariner", /submariner|\bsub\b|\b1266[01]\d|\b1246\d\d|\b1166[01]\d/],
  ["Rolex GMT-Master II", /gmt|pepsi|batman|batgirl|sprite|root ?beer|\b1267\d\d|\b1167\d\d/],
  ["Rolex Sky-Dweller", /sky-?dweller|\b3369\d\d|\b3269\d\d/],
  ["Rolex Day-Date", /day-?date|president|\b2283\d\d|\b2282\d\d|\b2182\d\d/],
  ["Rolex Datejust", /datejust|\b1263\d\d|\b1262\d\d|\b1263\d\d|\b2783\d\d/],
  ["Rolex Sea-Dweller / Deepsea", /sea-?dweller|deepsea|\b1266[06]0/],
  ["Rolex Yacht-Master", /yacht-?master|\b2266\d\d|\b1266[2-5]\d/],
  ["Rolex Explorer", /explorer|\b2240\d\d|\b2265\d\d/],
  ["Rolex Land-Dweller", /land-?dweller|\b1273\d\d/],
  ["Rolex Oyster Perpetual", /oyster perpetual|\b1240\d\d|\b1243\d\d/],
  ["Patek Philippe Nautilus", /nautilus|\b57[12]\d\b|\b5711|\b5712|\b5811|\b5726|\b5980|\b5990/],
  ["Patek Philippe Aquanaut", /aquanaut|\b516[4-8]|\b5968/],
  ["Patek Philippe Calatrava", /calatrava|\b5227|\b6119|\b5196/],
  ["Audemars Piguet Royal Oak Offshore", /offshore/],
  ["Audemars Piguet Royal Oak", /royal oak|\b15500|\b15510|\b16202|\b15202|\b15400|\b26240|\b26331/],
  ["Audemars Piguet Code 11.59", /11\.59/],
  ["Richard Mille", /richard mille|\brm ?0?\d{2}/],
  ["Omega Speedmaster", /speedmaster|moonwatch/],
  ["Omega Seamaster", /seamaster|aqua terra|planet ocean/],
  ["Cartier Santos", /santos/],
  ["Cartier Tank", /\btank\b/],
  ["Vacheron Constantin Overseas", /overseas/],
  ["Tudor Black Bay", /black bay/],
];
const BRANDS: [string, RegExp][] = [
  ["Rolex (otros)", /rolex/], ["Patek Philippe (otros)", /patek/], ["Audemars Piguet (otros)", /audemars|\bap\b/], ["Cartier (otros)", /cartier/],
  ["Omega (otros)", /omega/], ["Hublot", /hublot/], ["Panerai", /panerai/], ["Vacheron Constantin (otros)", /vacheron/], ["Tudor (otros)", /tudor/],
  ["Breitling", /breitling/], ["IWC", /\biwc\b/], ["Jaeger-LeCoultre", /jaeger|lecoultre/], ["A. Lange & Söhne", /lange/],
];

export function familyOf(text: string) {
  const t = text.toLowerCase();
  return FAMILIES.find(([, re]) => re.test(t))?.[0] ?? BRANDS.find(([, re]) => re.test(t))?.[0] ?? null;
}

type Person = { id: string; name: string | null; query: string };
export type DemandRow = { family: string; people: Person[]; stock: { id: string; sku: string; title: string }[] };

export async function demandBoard(sinceDays = 180) {
  const db = adminDb();
  const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString();
  const [alerts, leads, stock] = await Promise.all([
    db.from("watch_alerts").select("query, customer:customers(id, name)").eq("active", true),
    db.from("customers").select("id, name, interests").not("stage", "in", "(won,lost)").not("interests", "is", null).gte("last_activity_at", since),
    db.from("inventory_items").select("id, sku, brand, model, reference").in("status", ["in_stock", "reserved"]),
  ]);

  const rows = new Map<string, DemandRow>();
  const row = (family: string) => rows.get(family) ?? rows.set(family, { family, people: [], stock: [] }).get(family)!;
  const addPerson = (family: string | null, p: Person) => {
    if (!family) return;
    const r = row(family);
    if (!r.people.some((x) => x.id === p.id)) r.people.push(p);
  };

  type AlertRow = { query: string; customer: { id: string; name: string | null } | null };
  for (const a of (alerts.data ?? []) as unknown as AlertRow[]) {
    if (a.customer) addPerson(familyOf(a.query), { id: a.customer.id, name: a.customer.name, query: a.query });
  }
  for (const c of leads.data ?? []) {
    for (const line of String(c.interests).split("\n")) addPerson(familyOf(line), { id: c.id as string, name: c.name as string | null, query: line.slice(0, 80) });
  }
  for (const i of stock.data ?? []) {
    const title = [i.brand, i.model, i.reference].filter(Boolean).join(" ");
    const family = familyOf(title);
    if (family) row(family).stock.push({ id: i.id as string, sku: i.sku as string, title });
  }
  // Primero lo que más se pide y menos se tiene
  return [...rows.values()].sort((a, b) => b.people.length - b.stock.length - (a.people.length - a.stock.length) || b.people.length - a.people.length);
}
