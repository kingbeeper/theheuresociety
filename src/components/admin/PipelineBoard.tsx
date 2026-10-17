"use client";


import { useTr } from "@/components/admin/AdminLang";
import Link from "next/link";
import { useOptimistic, useTransition } from "react";
import { STAGE_LABEL, type Stage } from "@/lib/crm-labels";
import { setStage } from "@/app/admin/actions";

// Embudo de ventas: una columna por etapa; los clientes se arrastran de una a otra (en el móvil,
// con el selector de cada tarjeta). Cada columna suma el valor de lo que hay abierto.

export type PipelineCard = { id: string; name: string; stage: Stage; source: string; wants: string | null; value: number; ago: string; followUp: string | null };
const COLUMNS: Stage[] = ["new", "contacted", "qualified", "appointment", "negotiating", "won"];
const money = (n: number) => (n ? `$${Math.round(n).toLocaleString("en-US")}` : "");

export function PipelineBoard({ cards }: { cards: PipelineCard[] }) {
  const tr = useTr();
  const [, start] = useTransition();
  const [list, move] = useOptimistic(cards, (state, { id, stage }: { id: string; stage: Stage }) => state.map((c) => (c.id === id ? { ...c, stage } : c)));
  const change = (id: string, stage: Stage) =>
    start(async () => {
      move({ id, stage });
      await setStage(id, stage);
    });

  return (
    // Móvil: columnas de ancho fijo que se deslizan de lado (y encajan al soltar); escritorio: las 6 a la vista
    <div className="-mx-5 snap-x snap-mandatory overflow-x-auto px-5 pb-4 md:mx-0 md:px-0">
      <div className="grid grid-cols-[repeat(6,minmax(230px,1fr))] gap-3 md:grid-cols-[repeat(6,minmax(170px,1fr))]">
        {COLUMNS.map((stage) => {
          const col = list.filter((c) => c.stage === stage);
          const total = col.reduce((a, c) => a + c.value, 0);
          return (
            <section
              key={stage}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                const id = e.dataTransfer.getData("text/plain");
                if (id && list.find((c) => c.id === id)?.stage !== stage) change(id, stage);
              }}
              className="min-h-[60vh] min-w-0 snap-start border border-line bg-forest/50"
              aria-label={tr(STAGE_LABEL[stage])}
            >
              <header className="sticky top-0 border-b border-line bg-forest px-3 py-2.5">
                <p className="text-[0.62rem] tracking-[0.2em] uppercase text-brass">{tr(STAGE_LABEL[stage])} · {col.length}</p>
                <p className="text-xs tabular-nums text-stone">{money(total) || "—"}</p>
              </header>
              <ul className="grid gap-2 p-2">
                {col.map((c) => (
                  <li
                    key={c.id}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData("text/plain", c.id)}
                    className="min-w-0 cursor-grab overflow-hidden border border-line bg-ink/70 p-2.5 text-sm active:cursor-grabbing"
                  >
                    <Link href={`/admin/leads/${c.id}`} className="block truncate hover:text-brass">{c.name}</Link>
                    {c.wants && <p className="mt-0.5 line-clamp-2 text-xs text-stone">{c.wants}</p>}
                    <p className="mt-1 flex justify-between gap-2 text-[0.68rem] text-stone/80">
                      <span className="truncate">{c.source} · {c.ago}</span>
                      {c.value > 0 && <span className="tabular-nums text-brass">{money(c.value)}</span>}
                    </p>
                    {c.followUp && <p className="mt-1 text-[0.68rem] text-amber-200">⏰ {c.followUp}</p>}
                    <select
                      value={c.stage}
                      onChange={(e) => change(c.id, e.target.value as Stage)}
                      aria-label={tr("Mover a otra etapa")}
                      className="mt-2 w-full min-w-0 border border-line bg-ink px-2 py-1.5 text-base text-stone md:hidden"
                    >
                      {[...COLUMNS, "lost" as Stage].map((s) => <option key={s} value={s}>{tr(STAGE_LABEL[s])}</option>)}
                    </select>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
