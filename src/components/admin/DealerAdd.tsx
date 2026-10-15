"use client";

import { useActionState, useState } from "react";
import { addDealerAction } from "@/app/admin/actions";

const field = "w-full border border-line bg-ink/60 px-3 py-2.5 text-sm text-ivory placeholder:text-stone/50 outline-none transition-colors focus:border-brass/70";
const label = "mb-1.5 block text-[0.62rem] tracking-[0.22em] uppercase text-stone";

// Añadir un dealer nuevo (queda como cliente con la etiqueta «Dealer»)
export function DealerAdd({ open: startOpen = false }: { open?: boolean }) {
  const [state, action, pending] = useActionState(addDealerAction, null);
  const [open, setOpen] = useState(startOpen);
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="bg-ivory px-5 py-2.5 text-[0.68rem] tracking-[0.22em] uppercase text-ink hover:bg-brass">
        + Nuevo dealer
      </button>
    );
  return (
    <form action={action} key={state && "ok" in state ? state.ok : "form"} className="grid gap-3 border border-line/60 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label><span className={label}>Nombre *</span><input name="name" required placeholder="Carlos Pérez" className={field} /></label>
        <label><span className={label}>Empresa</span><input name="company" placeholder="Miami Time Co." className={field} /></label>
        <label><span className={label}>WhatsApp / teléfono</span><input name="phone" type="tel" placeholder="+1 305 555 1234" className={field} /></label>
        <label><span className={label}>Correo</span><input name="email" type="email" className={field} /></label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button disabled={pending} className="bg-ivory px-5 py-2.5 text-[0.68rem] tracking-[0.22em] uppercase text-ink hover:bg-brass disabled:opacity-60">
          {pending ? "Guardando…" : "Guardar dealer"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-stone underline hover:text-ivory">Cerrar</button>
        {state && "error" in state && <p className="text-sm text-red-200/90">{state.error}</p>}
        {state && "ok" in state && <p className="text-sm text-emerald-200/90">Listo: {state.ok} ya está en tus dealers.</p>}
      </div>
    </form>
  );
}
