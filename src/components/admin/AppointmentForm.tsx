"use client";

import { useActionState, useState } from "react";
import { createAppointment, rescheduleAppointment } from "@/app/admin/actions";
import { SOURCE_LABEL } from "@/lib/crm-labels";

const field =
  "w-full border border-line bg-ink/60 px-3 py-2.5 text-sm text-ivory placeholder:text-stone/50 outline-none transition-colors focus:border-brass/70";
const label = "mb-1.5 block text-[0.62rem] tracking-[0.22em] uppercase text-stone";

type Option = { id: string; label: string };

// Cita añadida a mano: con un cliente del CRM o uno nuevo, a cualquier hora
export function AppointmentForm({ customers, watches, customerId, today }: { customers: Option[]; watches: Option[]; customerId?: string; today: string }) {
  const [state, action, pending] = useActionState(createAppointment, null);
  const [customer, setCustomer] = useState(customerId ?? "");
  // Al guardar con éxito se vacía el formulario (clave nueva)
  const [round, setRound] = useState(0);
  const [seen, setSeen] = useState<unknown>(null);
  if (state && "ok" in state && state !== seen) {
    setSeen(state);
    setRound((r) => r + 1);
    setCustomer("");
  }

  return (
    <form key={round} action={action} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-4">
        <label><span className={label}>Fecha *</span><input name="date" type="date" min={today} defaultValue={today} required className={field} /></label>
        <label><span className={label}>Hora *</span><input name="time" type="time" step={900} defaultValue="11:00" required className={field} /></label>
        <label>
          <span className={label}>Tipo</span>
          <select name="kind" defaultValue="office" className={field}>
            <option value="office">En la oficina</option>
            <option value="video">Videollamada</option>
          </select>
        </label>
        <label className="flex items-end gap-2 pb-3 text-sm text-stone">
          <input name="confirmed" type="checkbox" defaultChecked className="h-4 w-4 accent-[#b08d57]" /> Ya confirmada
        </label>
      </div>

      <label>
        <span className={label}>Cliente</span>
        <select name="customer_id" value={customer} onChange={(e) => setCustomer(e.target.value)} className={field}>
          <option value="">— Cliente nuevo —</option>
          {customers.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </label>
      {!customer && (
        <div className="grid gap-4 sm:grid-cols-4">
          <label><span className={label}>Nombre *</span><input name="name" className={field} /></label>
          <label><span className={label}>Teléfono</span><input name="phone" className={field} /></label>
          <label><span className={label}>Correo</span><input name="email" type="email" className={field} /></label>
          <label>
            <span className={label}>¿Cómo nos conoció?</span>
            <select name="source" defaultValue="walk_in" className={field}>
              {Object.entries(SOURCE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <label>
          <span className={label}>Relojes que quiere ver</span>
          <select name="pieces" multiple size={Math.min(5, Math.max(2, watches.length))} className={field}>
            {watches.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
          </select>
          <span className="mt-1 block text-[0.7rem] text-stone/80">Ctrl / ⌘ + clic para elegir varios</span>
        </label>
        <label><span className={label}>Nota</span><textarea name="note" rows={3} placeholder="Viene con su esposa, quiere probar el Nautilus…" className={field} /></label>
      </div>

      {state && "clash" in state && (
        <label className="flex items-center gap-2 text-sm text-amber-200">
          <input name="force" type="checkbox" className="h-4 w-4" /> Guardar igualmente (dos citas a la vez)
        </label>
      )}
      <div className="flex items-center gap-4">
        <button disabled={pending} className="bg-ivory px-5 py-2.5 text-[0.68rem] tracking-[0.22em] uppercase text-ink hover:bg-brass disabled:opacity-60">
          {pending ? "Guardando…" : "Añadir cita"}
        </button>
        {state && "error" in state && <p className="text-sm text-red-200/90">{state.error}</p>}
        {state && "ok" in state && !pending && <p className="text-sm text-emerald-200/90">Cita añadida. Ese horario ya no aparece libre en la web ni en los bots.</p>}
      </div>
    </form>
  );
}

// Cambiar el día o la hora de una cita
export function RescheduleForm({ id, date, time }: { id: string; date: string; time: string }) {
  const [state, action, pending] = useActionState(rescheduleAppointment.bind(null, id), null);
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-xs text-stone underline hover:text-ivory">Cambiar fecha u hora</summary>
      <form action={action} className="mt-2 flex flex-wrap items-center gap-2">
        <input name="date" type="date" defaultValue={date} required className="border border-line bg-ink/60 px-2 py-1.5 text-sm" />
        <input name="time" type="time" step={900} defaultValue={time} required className="border border-line bg-ink/60 px-2 py-1.5 text-sm" />
        {state && "clash" in state && <label className="flex items-center gap-1 text-xs text-amber-200"><input name="force" type="checkbox" /> Igualmente</label>}
        <button disabled={pending} className="border border-line px-3 py-1.5 text-[0.62rem] tracking-[0.18em] uppercase text-stone hover:text-ivory">{pending ? "…" : "Guardar"}</button>
        {state && "error" in state && <span className="text-xs text-red-200/90">{state.error}</span>}
      </form>
    </details>
  );
}
