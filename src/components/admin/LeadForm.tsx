"use client";


import { useTr } from "@/components/admin/AdminLang";
import { useActionState } from "react";
import { INTENT_LABEL, STAGES, STAGE_LABEL } from "@/lib/crm-labels";
import { updateLead } from "@/app/admin/actions";
import type { Customer } from "@/lib/crm";
import { REGIONS, guessRegion } from "@/lib/regions";
import { companyOf, withoutCompany } from "@/lib/company";

const field =
  "w-full border border-line bg-ink/60 px-3 py-2.5 text-sm text-ivory placeholder:text-stone/50 outline-none transition-colors focus:border-brass/70";
const label = "mb-1.5 block text-[0.62rem] tracking-[0.22em] uppercase text-stone";

// Datos del cliente, editables
export function LeadForm({ c }: { c: Customer }) {
  const tr = useTr();
  const [state, action, pending] = useActionState(updateLead.bind(null, c.id), null);
  // Un dealer ya está ganado y no es un prospecto: sin etapa, qué quiere ni presupuesto
  const dealer = c.tags.some((t) => t.toLowerCase() === "dealer");
  return (
    <form action={action} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label><span className={label}>{tr("Nombre")}</span><input name="name" defaultValue={c.name ?? ""} className={field} /></label>
        <label><span className={label}>{tr("Empresa")}</span><input name="company" defaultValue={companyOf(c.notes) ?? ""} placeholder={tr("Miami Time Co.")} className={field} /></label>
        {!dealer && (
          <label>
            <span className={label}>{tr("Etapa")}</span>
            <select name="stage" defaultValue={c.stage} className={field}>
              {STAGES.map((s) => <option key={s} value={s}>{tr(STAGE_LABEL[s])}</option>)}
            </select>
          </label>
        )}
        <label><span className={label}>{tr("Teléfono")}</span><input name="phone" defaultValue={c.phone ?? ""} className={field} /></label>
        <label><span className={label}>{tr("Correo")}</span><input name="email" type="email" defaultValue={c.email ?? ""} className={field} /></label>
        {dealer ? (
          <input type="hidden" name="intent" value={c.intent ?? ""} />
        ) : (
          <label>
            <span className={label}>{tr("Quiere")}</span>
            <select name="intent" defaultValue={c.intent ?? ""} className={field}>
              <option value="">—</option>
              {Object.entries(INTENT_LABEL).map(([k, v]) => <option key={k} value={k}>{tr(v)}</option>)}
            </select>
          </label>
        )}
        <label>
          <span className={label}>{tr("Región")}</span>
          <select name="region" defaultValue={c.region ?? ""} className={field}>
            <option value="">{(() => { const g = guessRegion(c.phone); return g ? tr("— (sugerida: {r})", { r: tr(REGIONS[g]) }) : "—"; })()}</option>
            {Object.entries(REGIONS).map(([k, v]) => <option key={k} value={k}>{tr(v)}</option>)}
          </select>
        </label>
        {dealer ? (
          <input type="hidden" name="budget" value={c.budget ?? ""} />
        ) : (
          <label><span className={label}>{tr("Presupuesto (USD)")}</span><input name="budget" defaultValue={c.budget ?? ""} inputMode="numeric" className={field} /></label>
        )}
      </div>
      <label><span className={label}>{dealer ? tr("Qué maneja (marcas, especialidad)") : tr("Qué busca")}</span><textarea name="interests" defaultValue={c.interests ?? ""} rows={2} className={field} /></label>
      <label><span className={label}>{tr("Etiquetas (separadas por comas)")}</span><input name="tags" defaultValue={c.tags.join(", ")} placeholder={tr("VIP, coleccionista, Rolex")} className={field} /></label>
      <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
        <label><span className={label}>{tr("Próximo seguimiento")}</span><input name="follow_up_at" type="date" defaultValue={c.follow_up_at ?? ""} className={field} /></label>
        <label><span className={label}>{tr("Para qué")}</span><input name="follow_up_note" defaultValue={c.follow_up_note ?? ""} placeholder={tr("Llamar para ver si decidió, enviarle el Daytona…")} className={field} /></label>
      </div>
      <label><span className={label}>{tr("Notas internas")}</span><textarea name="notes" defaultValue={withoutCompany(c.notes)} rows={3} className={field} /></label>
      <div className="flex items-center gap-4">
        <button disabled={pending} className="bg-ivory px-5 py-2.5 text-[0.68rem] tracking-[0.22em] uppercase text-ink hover:bg-brass disabled:opacity-60">
          {pending ? tr("Guardando…") : tr("Guardar")}
        </button>
        {state?.error && <p className="text-sm text-red-200/90">{state.error}</p>}
        {state?.ok && !pending && <p className="text-sm text-emerald-200/90">{tr("Guardado")}</p>}
      </div>
    </form>
  );
}
