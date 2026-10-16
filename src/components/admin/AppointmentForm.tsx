"use client";


import { useAdminLang, useTr } from "@/components/admin/AdminLang";
import { useActionState, useState } from "react";
import { apptCallAction, apptCallDoneAction, apptNextAction, apptNoteAction, apptOutcomeAction, createAppointment, rescheduleAppointment } from "@/app/admin/actions";
import { SOURCE_LABEL } from "@/lib/crm-labels";

const field =
  "w-full border border-line bg-ink/60 px-3 py-2.5 text-sm text-ivory placeholder:text-stone/50 outline-none transition-colors focus:border-brass/70";
const label = "mb-1.5 block text-[0.62rem] tracking-[0.22em] uppercase text-stone";

type Option = { id: string; label: string };

// Cita añadida a mano: con un cliente del CRM o uno nuevo, a cualquier hora
export function AppointmentForm({ customers, watches, customerId, today }: { customers: Option[]; watches: Option[]; customerId?: string; today: string }) {
  const tr = useTr();
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
        <label><span className={label}>{tr("Fecha *")}</span><input name="date" type="date" min={today} defaultValue={today} required className={field} /></label>
        <label><span className={label}>{tr("Hora *")}</span><input name="time" type="time" step={900} defaultValue="11:00" required className={field} /></label>
        <label>
          <span className={label}>{tr("Tipo")}</span>
          <select name="kind" defaultValue="office" className={field}>
            <option value="office">{tr("En la oficina")}</option>
            <option value="video">{tr("Videollamada")}</option>
          </select>
        </label>
        <label className="flex items-end gap-2 pb-3 text-sm text-stone">
          <input name="confirmed" type="checkbox" defaultChecked className="h-4 w-4 accent-[#b08d57]" /> {tr("Ya confirmada")}
        </label>
      </div>

      <label>
        <span className={label}>{tr("Cliente")}</span>
        <select name="customer_id" value={customer} onChange={(e) => setCustomer(e.target.value)} className={field}>
          <option value="">{tr("— Cliente nuevo —")}</option>
          {customers.map((c) => <option key={c.id} value={c.id}>{tr(c.label)}</option>)}
        </select>
      </label>
      {!customer && (
        <div className="grid gap-4 sm:grid-cols-4">
          <label><span className={label}>{tr("Nombre *")}</span><input name="name" className={field} /></label>
          <label><span className={label}>{tr("Teléfono")}</span><input name="phone" className={field} /></label>
          <label><span className={label}>{tr("Correo")}</span><input name="email" type="email" className={field} /></label>
          <label>
            <span className={label}>{tr("¿Cómo nos conoció?")}</span>
            <select name="source" defaultValue="walk_in" className={field}>
              {Object.entries(SOURCE_LABEL).map(([k, l]) => <option key={k} value={k}>{tr(l)}</option>)}
            </select>
          </label>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <label>
          <span className={label}>{tr("Relojes que quiere ver")}</span>
          <select name="pieces" multiple size={Math.min(5, Math.max(2, watches.length))} className={field}>
            {watches.map((w) => <option key={w.id} value={w.id}>{tr(w.label)}</option>)}
          </select>
          <span className="mt-1 block text-[0.7rem] text-stone/80">{tr("Ctrl / ⌘ + clic para elegir varios")}</span>
        </label>
        <label><span className={label}>{tr("Nota")}</span><textarea name="note" rows={3} placeholder={tr("Viene con su esposa, quiere probar el Nautilus…")} className={field} /></label>
      </div>

      {state && "clash" in state && (
        <label className="flex items-center gap-2 text-sm text-amber-200">
          <input name="force" type="checkbox" className="h-4 w-4" /> {tr("Guardar igualmente (dos citas a la vez)")}
        </label>
      )}
      <div className="flex items-center gap-4">
        <button disabled={pending} className="bg-ivory px-5 py-2.5 text-[0.68rem] tracking-[0.22em] uppercase text-ink hover:bg-brass disabled:opacity-60">
          {pending ? tr("Guardando…") : tr("Añadir cita")}
        </button>
        {state && "error" in state && <p className="text-sm text-red-200/90">{state.error}</p>}
        {state && "ok" in state && !pending && <p className="text-sm text-emerald-200/90">{tr("Cita añadida. Ese horario ya no aparece libre en la web ni en los bots.")}</p>}
      </div>
    </form>
  );
}

// Cambiar el día o la hora de una cita
export function RescheduleForm({ id, date, time }: { id: string; date: string; time: string }) {
  const tr = useTr();
  const [state, action, pending] = useActionState(rescheduleAppointment.bind(null, id), null);
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-xs text-stone underline hover:text-ivory">{tr("Cambiar fecha u hora")}</summary>
      <form action={action} className="mt-2 flex flex-wrap items-center gap-2">
        <input name="date" type="date" defaultValue={date} required className="border border-line bg-ink/60 px-2 py-1.5 text-sm" />
        <input name="time" type="time" step={900} defaultValue={time} required className="border border-line bg-ink/60 px-2 py-1.5 text-sm" />
        {state && "clash" in state && <label className="flex items-center gap-1 text-xs text-amber-200"><input name="force" type="checkbox" /> {tr("Igualmente")}</label>}
        <button disabled={pending} className="border border-line px-3 py-1.5 text-[0.62rem] tracking-[0.18em] uppercase text-stone hover:text-ivory">{pending ? "…" : tr("Guardar")}</button>
        {state && "error" in state && <span className="text-xs text-red-200/90">{state.error}</span>}
      </form>
    </details>
  );
}

// Seguimiento de una cita: resultado, notas, llamadas programadas y otra cita para el mismo cliente
type FollowUp = { id: string; kind: string; body: string | null; due_at: string | null; due_time?: string | null; done_at: string | null; created_by: string | null; created_at: string };

const small = "border border-line bg-ink/60 px-2 py-1.5 text-sm";
const mini = "border border-line px-3 py-1.5 text-[0.62rem] tracking-[0.18em] uppercase text-stone hover:text-ivory";
const KIND_ICON: Record<string, string> = { note: "📝", call: "⏰", appointment: "📅", outcome: "🔔" };

export function AppointmentFollowUp({ id, followups, outcome, outcomes, today, open }: { id: string; followups: FollowUp[]; outcome: string | null; outcomes: [string, string][]; today: string; open?: boolean }) {
  const tr = useTr();
  const lang = useAdminLang();
  const [state, action, pending] = useActionState(apptNextAction.bind(null, id), null);
  const pendingCalls = followups.filter((f) => f.kind === "call" && !f.done_at);
  const day = (iso: string) => new Intl.DateTimeFormat(lang === "en" ? "en-US" : "es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/New_York" }).format(new Date(iso));
  return (
    <details open={open} className="mt-2 border-l border-brass/40 pl-3 text-sm">
      <summary className="cursor-pointer text-xs text-brass hover:text-ivory">
        {tr("Follow-up")}{followups.length ? ` (${followups.length})` : ""}{outcome ? ` · ${outcomes.find(([k]) => k === outcome)?.[1] ?? outcome}` : ""}{pendingCalls.length ? ` · ⏰ ${pendingCalls[0].due_at}${pendingCalls[0].due_time ? ` ${pendingCalls[0].due_time}` : ""}` : ""}
      </summary>
      <div className="mt-3 grid gap-4">
        <div>
          <p className="mb-1.5 text-[0.6rem] tracking-[0.18em] uppercase text-stone">{tr("Follow-up")}</p>
          <div className="flex flex-wrap gap-1.5">
            {outcomes.map(([k, l]) => (
              <form key={k} action={apptOutcomeAction.bind(null, id, k)}>
                <button className={`${mini} ${outcome === k ? "border-brass text-brass" : ""}`}>{l}</button>
              </form>
            ))}
          </div>
        </div>

        {followups.length > 0 && (
          <ul className="space-y-1.5 text-xs">
            {followups.map((f) => (
              <li key={f.id}>
                <span className="text-stone">{day(f.created_at)}</span> · {KIND_ICON[f.kind] ?? "•"}{" "}
                {f.kind === "call" ? `${tr("Seguimiento el")} ${f.due_at}${f.due_time ? ` ${tr("a las")} ${f.due_time}` : ""}${f.body ? `: ${f.body}` : ""}${f.done_at ? tr(" · ✓ hecho") : ""}` : f.kind === "appointment" ? `${tr("Nueva cita")}: ${f.body}` : f.kind === "outcome" ? `Follow-up: ${f.body}` : f.body}
                {f.created_by ? <span className="text-stone"> · {f.created_by.split("@")[0]}</span> : null}
              </li>
            ))}
          </ul>
        )}

        {pendingCalls.map((c) => (
          <form key={c.id} action={apptCallDoneAction.bind(null, c.id)} className="flex flex-wrap items-center gap-2 text-xs">
            <span className={c.due_at && c.due_at <= today ? "text-amber-200" : "text-stone"}>{tr("⏰ Seguimiento del")} {c.due_at}{c.due_time ? ` ${c.due_time}` : ""}:</span>
            <input name="result" placeholder={tr("¿Qué respondió? (opcional)")} className={`${small} min-w-0 flex-1`} />
            <button className={mini}>{tr("Hecho")}</button>
          </form>
        ))}

        <form action={apptNoteAction.bind(null, id)} className="flex flex-wrap gap-2">
          <input name="body" required placeholder={tr("Añadir nota: qué le gustó, presupuesto, próximos pasos…")} className={`${small} min-w-0 flex-1`} />
          <button className={mini}>{tr("Guardar nota")}</button>
        </form>

        <form action={apptCallAction.bind(null, id)} className={`flex flex-wrap items-center gap-2 ${outcome === "sent_waiting" && !pendingCalls.length ? "border border-amber-300/50 p-2" : ""}`}>
          <span className="text-xs text-stone">{tr("⏰ Recordatorio de seguimiento")}</span>
          <input name="date" type="date" required min={today} className={small} />
          <input name="time" type="time" step={900} className={small} aria-label={tr("Hora (opcional)")} />
          <input name="note" key={outcome ?? "none"} defaultValue={outcome === "sent_waiting" ? "Artículo enviado: ver si respondió" : ""} placeholder={tr("Para qué (opcional)")} className={`${small} min-w-0 flex-1`} />
          <button className={mini}>{tr("Programar")}</button>
          {outcome === "sent_waiting" && !pendingCalls.length && <span className="w-full text-xs text-amber-200">{tr("Artículo enviado: elige cuándo darle seguimiento. Saldrá en tu calendario de citas, en el resumen de las 8:00 y en «Clientes de hoy».")}</span>}
        </form>

        <form action={action} className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-stone">{tr("📅 Otra cita")}</span>
          <input name="date" type="date" required min={today} className={small} />
          <input name="time" type="time" step={900} required className={small} />
          <select name="kind" defaultValue="office" className={small}>
            <option value="office">{tr("Oficina")}</option>
            <option value="video">{tr("Videollamada")}</option>
          </select>
          <input name="note" placeholder={tr("Nota (opcional)")} className={`${small} min-w-0 flex-1`} />
          {state && "clash" in state && <label className="flex items-center gap-1 text-xs text-amber-200"><input name="force" type="checkbox" /> {tr("Igualmente")}</label>}
          <button disabled={pending} className={mini}>{pending ? "…" : tr("Agendar")}</button>
          {state && "error" in state && <span className="w-full text-xs text-red-200/90">{state.error}</span>}
          {state && "ok" in state && !pending && <span className="w-full text-xs text-emerald-200/90">{tr("Cita agendada para el mismo cliente.")}</span>}
        </form>
      </div>
    </details>
  );
}
