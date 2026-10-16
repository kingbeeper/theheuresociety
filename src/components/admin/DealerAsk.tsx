"use client";


import { useTr } from "@/components/admin/AdminLang";
import { useActionState, useState } from "react";
import { askDealersAction } from "@/app/admin/actions";

const field = "w-full border border-line bg-ink/60 px-3 py-2.5 text-sm text-ivory placeholder:text-stone/50 outline-none transition-colors focus:border-brass/70";
const label = "mb-1.5 block text-[0.62rem] tracking-[0.22em] uppercase text-stone";

// Pedir una pieza a los dealers: qué se busca, presupuesto y a quién (todos marcados por defecto)
export function DealerAsk({ dealers, query = "", budget, documentId, customerId }: { dealers: { id: string; name: string | null; phone: string | null; reachable: boolean }[]; query?: string; budget?: number | null; documentId?: string | null; customerId?: string | null }) {
  const tr = useTr();
  const [state, action, pending] = useActionState(askDealersAction, null);
  const [all, setAll] = useState(true);
  return (
    <form action={action} key={state && "ok" in state ? "sent" : "form"} className="grid gap-4">
      {documentId && <input type="hidden" name="document_id" value={documentId} />}
      {customerId && <input type="hidden" name="customer_id" value={customerId} />}
      <div className="grid gap-4 sm:grid-cols-[1fr_160px]">
        <label><span className={label}>{tr("Qué buscas *")}</span><input name="query" required defaultValue={query} placeholder={tr("Rolex Daytona 126500LN blanco, 2023+, full set")} className={field} /></label>
        <label><span className={label}>{tr("Presupuesto $")}</span><input name="budget" inputMode="decimal" defaultValue={budget ?? ""} className={field} /></label>
      </div>
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className={label}>{tr("A qué dealers (")}{dealers.length})</span>
          <button type="button" onClick={() => setAll((a) => !a)} className="text-xs text-stone underline hover:text-ivory">{all ? tr("Quitar todos") : tr("Marcar todos")}</button>
        </div>
        <div className="grid max-h-56 gap-1 overflow-y-auto border border-line/60 p-2 sm:grid-cols-2">
          {dealers.map((d) => (
            <label key={`${d.id}-${all}`} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="dealer" value={d.id} defaultChecked={all && d.reachable} className="h-4 w-4" />
              <span className="truncate">{d.name ?? d.phone ?? tr("Dealer")}</span>
              {!d.reachable && <span className="text-xs text-stone">{tr("(sin teléfono)")}</span>}
            </label>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button disabled={pending || !dealers.length} className="bg-ivory px-5 py-2.5 text-[0.68rem] tracking-[0.22em] uppercase text-ink hover:bg-brass disabled:opacity-60">
          {pending ? tr("Preparando…") : tr("Preparar mensajes")}
        </button>
        {state && "error" in state && <p className="text-sm text-red-200/90">{state.error}</p>}
        {state && "ok" in state && <p className="text-sm text-emerald-200/90">{tr("Listo: abajo tienes un botón de WhatsApp por dealer, con el mensaje escrito.")}</p>}
      </div>
    </form>
  );
}
