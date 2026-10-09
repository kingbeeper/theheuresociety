import Link from "next/link";
import { connection } from "next/server";
import { requireUser } from "@/lib/admin-auth";
import { adminDb } from "@/lib/supabase";
import { awayItems, openCount } from "@/lib/stock-count";
import { LOCATIONS, type Location } from "@/lib/locations";
import { buttonClass, Card, fmtDateTime, ghostButtonClass, PageTitle } from "@/components/admin/ui";
import { finishCountAction, markCountedAction, startCountAction } from "../../../inventory-actions";

export const metadata = { title: "Conteo de inventario" };

export default async function CountPage({ searchParams }: PageProps<"/admin/inventario/conteo">) {
  await connection();
  await requireUser("inventario");
  const sp = await searchParams;
  const count = await openCount();
  const away = await awayItems();
  const { data: last } = await adminDb().from("inventory_counts").select("*").not("finished_at", "is", null).order("finished_at", { ascending: false }).limit(1).maybeSingle();

  if (!count) {
    const missing = sp.faltan ? String(sp.faltan).split(",").filter(Boolean) : [];
    const { data: missingItems } = missing.length ? await adminDb().from("inventory_items").select("id, sku, brand, model, location").in("id", missing) : { data: [] };
    return (
      <>
        <Link href="/admin/inventario" className="text-[0.66rem] tracking-[0.2em] uppercase text-stone hover:text-ivory">← Inventario</Link>
        <PageTitle eyebrow="Inventario" title="Conteo de inventario" />
        {sp.terminado && (
          <Card className="mb-6" title={missing.length ? `⚠️ Faltan ${missing.length}` : "✅ Está todo"}>
            {missing.length ? (
              <ul className="space-y-1 text-sm">
                {(missingItems ?? []).map((i) => (
                  <li key={i.id}><Link href={`/admin/inventario/${i.id}`} className="hover:text-brass">{i.sku} · {i.brand} {i.model ?? ""}</Link> <span className="text-xs text-stone">· debería estar en {LOCATIONS[i.location as Location] ?? "—"}</span></li>
                ))}
              </ul>
            ) : <p className="text-sm text-stone">Todos los relojes esperados se encontraron.</p>}
          </Card>
        )}
        <Card>
          <p className="text-sm text-stone">
            Recorre la tienda y marca cada reloj que veas (o escanea su etiqueta QR con el móvil y pulsa «Contado»). Al terminar te digo si falta alguno.
            Los relojes en memo o en el relojero no cuentan: están fuera.
          </p>
          {last && <p className="mt-2 text-xs text-stone">Último conteo: {fmtDateTime(last.finished_at as string)} · {(last.found as string[]).length}/{(last.expected as string[]).length} encontrados</p>}
          <form action={startCountAction} className="mt-4"><button className={buttonClass}>Empezar conteo</button></form>
        </Card>
      </>
    );
  }

  const { data } = await adminDb().from("inventory_items").select("id, sku, brand, model, reference, location").in("id", count.expected).order("sku");
  const items = data ?? [];
  const found = new Set(count.found);
  const groups = new Map<string, typeof items>();
  for (const i of items) {
    const k = (i.location as string) ?? "none";
    groups.set(k, [...(groups.get(k) ?? []), i]);
  }

  return (
    <>
      <Link href="/admin/inventario" className="text-[0.66rem] tracking-[0.2em] uppercase text-stone hover:text-ivory">← Inventario</Link>
      <PageTitle
        eyebrow={`Conteo empezado ${fmtDateTime(count.started_at)}`}
        title={`${found.size} de ${items.length} contados`}
        action={<form action={finishCountAction.bind(null, count.id)}><button className={buttonClass}>Terminar conteo</button></form>}
      />
      <div className="mb-6 h-2 bg-ink"><div className="h-full bg-brass/70" style={{ width: `${items.length ? (found.size / items.length) * 100 : 0}%` }} /></div>

      <div className="grid gap-6 xl:grid-cols-2">
        {[...groups.entries()].map(([loc, list]) => (
          <Card key={loc} title={`${LOCATIONS[loc as Location] ?? "Sin ubicación"} · ${list.filter((i) => found.has(i.id)).length}/${list.length}`}>
            <ul className="divide-y divide-line/60">
              {list.map((i) => {
                const ok = found.has(i.id);
                return (
                  <li key={i.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <span className={`min-w-0 truncate ${ok ? "text-stone line-through" : ""}`}>{i.sku} · {i.brand} {i.model ?? ""}</span>
                    <form action={markCountedAction.bind(null, count.id, i.id, !ok)}>
                      <button className={ok ? "text-[0.62rem] tracking-[0.16em] uppercase text-emerald-200" : ghostButtonClass}>{ok ? "✓ Contado" : "Contar"}</button>
                    </form>
                  </li>
                );
              })}
            </ul>
          </Card>
        ))}
        {away.size > 0 && (
          <Card title={`Fuera de la tienda · ${away.size}`}>
            <p className="text-xs text-stone">No hace falta contarlos.</p>
            <ul className="mt-2 space-y-1 text-sm text-stone">{[...away.values()].map((v, i) => <li key={i}>{v}</li>)}</ul>
          </Card>
        )}
      </div>
    </>
  );
}
