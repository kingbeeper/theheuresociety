import Link from "next/link";
import { connection } from "next/server";
import { requireUser } from "@/lib/admin-auth";
import { duplicateGroups } from "@/lib/merge";
import { SOURCE_LABEL, STAGE_LABEL, type Stage } from "@/lib/crm-labels";
import { Card, fmtDate, PageTitle } from "@/components/admin/ui";
import { mergeGroupAction } from "../../../actions";

export const metadata = { title: "Clientes duplicados" };

// Posibles duplicados (mismo teléfono, correo o nombre completo): eliges la ficha que se queda y las
// demás se fusionan en ella con todo su historial, citas, documentos y compras.
export default async function DuplicatesPage() {
  await connection();
  await requireUser("leads");
  const groups = await duplicateGroups();

  return (
    <>
      <Link href="/admin/leads" className="text-[0.66rem] tracking-[0.2em] uppercase text-stone hover:text-ivory">← Leads</Link>
      <PageTitle eyebrow="Leads" title={`Clientes duplicados · ${groups.length}`} />
      <p className="mb-6 max-w-3xl text-sm text-stone">
        Fichas que parecen la misma persona (mismo teléfono, correo o nombre completo). Pulsa <b>Conservar esta</b> en la ficha buena: las demás se fusionan en ella (historial, citas, documentos, compras, búsquedas, recordatorios…) y se completan los datos que le falten. No se puede deshacer, así que revisa que de verdad sean la misma persona.
      </p>
      {groups.length ? (
        <div className="grid gap-4 xl:grid-cols-2">
          {groups.map((g) => (
            <Card key={g[0].id}>
              <ul className="divide-y divide-line/60">
                {g.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm">
                    <div className="min-w-0">
                      <Link href={`/admin/leads/${c.id}`} className="hover:text-brass">{c.name ?? "Sin nombre"}</Link>
                      <p className="text-xs text-stone">{[c.phone, c.email, SOURCE_LABEL[c.source] ?? c.source, STAGE_LABEL[c.stage as Stage]].filter(Boolean).join(" · ")} · desde {fmtDate(c.created_at)}</p>
                    </div>
                    <form action={mergeGroupAction.bind(null, c.id, g.map((x) => x.id))}>
                      <button className="whitespace-nowrap border border-line px-3 py-1.5 text-[0.62rem] tracking-[0.16em] uppercase text-stone hover:text-ivory">Conservar esta</button>
                    </form>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      ) : (
        <p className="text-sm text-stone">No hay clientes duplicados. 🎉</p>
      )}
    </>
  );
}
