"use client";

import { useActionState } from "react";
import { INTENT_LABEL, STAGES, STAGE_LABEL } from "@/lib/crm-labels";
import { updateLead } from "@/app/admin/actions";
import type { Customer } from "@/lib/crm";

const field =
  "w-full border border-line bg-ink/60 px-3 py-2.5 text-sm text-ivory placeholder:text-stone/50 outline-none transition-colors focus:border-brass/70";
const label = "mb-1.5 block text-[0.62rem] tracking-[0.22em] uppercase text-stone";

// Datos del cliente, editables
export function LeadForm({ c }: { c: Customer }) {
  const [state, action, pending] = useActionState(updateLead.bind(null, c.id), null);
  return (
    <form action={action} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label><span className={label}>Nombre</span><input name="name" defaultValue={c.name ?? ""} className={field} /></label>
        <label>
          <span className={label}>Etapa</span>
          <select name="stage" defaultValue={c.stage} className={field}>
            {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
          </select>
        </label>
        <label><span className={label}>Teléfono</span><input name="phone" defaultValue={c.phone ?? ""} className={field} /></label>
        <label><span className={label}>Correo</span><input name="email" type="email" defaultValue={c.email ?? ""} className={field} /></label>
        <label>
          <span className={label}>Quiere</span>
          <select name="intent" defaultValue={c.intent ?? ""} className={field}>
            <option value="">—</option>
            {Object.entries(INTENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label><span className={label}>Presupuesto (USD)</span><input name="budget" defaultValue={c.budget ?? ""} inputMode="numeric" className={field} /></label>
      </div>
      <label><span className={label}>Qué busca</span><textarea name="interests" defaultValue={c.interests ?? ""} rows={2} className={field} /></label>
      <label><span className={label}>Etiquetas (separadas por comas)</span><input name="tags" defaultValue={c.tags.join(", ")} placeholder="VIP, coleccionista, Rolex" className={field} /></label>
      <label><span className={label}>Notas internas</span><textarea name="notes" defaultValue={c.notes ?? ""} rows={3} className={field} /></label>
      <div className="flex items-center gap-4">
        <button disabled={pending} className="bg-ivory px-5 py-2.5 text-[0.68rem] tracking-[0.22em] uppercase text-ink hover:bg-brass disabled:opacity-60">
          {pending ? "Guardando…" : "Guardar"}
        </button>
        {state?.error && <p className="text-sm text-red-200/90">{state.error}</p>}
        {state?.ok && !pending && <p className="text-sm text-emerald-200/90">Guardado</p>}
      </div>
    </form>
  );
}
