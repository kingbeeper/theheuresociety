"use client";

import { useActionState } from "react";
import { createDepositAction } from "@/app/admin/inventory-actions";

const field =
  "w-full border border-line bg-ink/60 px-3 py-2.5 text-sm text-ivory placeholder:text-stone/50 outline-none transition-colors focus:border-brass/70";

// Depósito con tarjeta para reservar: genera el enlace de pago para enviárselo al cliente
export function DepositForm({ itemId, customers }: { itemId: string; customers: { id: string; label: string }[] }) {
  const [state, action, pending] = useActionState(createDepositAction.bind(null, itemId), null);
  const msg = state && "url" in state ? `Hola, este es el enlace para el depósito y reservar su reloj en The Heure Society: ${state.url}` : "";
  return (
    <form action={action} className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-[140px_1fr_auto] sm:items-end">
        <input name="amount" inputMode="decimal" placeholder="Importe USD" required className={field} />
        <select name="customer_id" defaultValue="" className={field}>
          <option value="">— Cliente (opcional) —</option>
          {customers.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        <button disabled={pending} className="border border-line px-4 py-2.5 text-[0.66rem] tracking-[0.2em] uppercase text-stone hover:text-ivory disabled:opacity-60">
          {pending ? "…" : "Crear enlace"}
        </button>
      </div>
      {state && "error" in state && <p className="text-sm text-red-200/90">{state.error}</p>}
      {state && "url" in state && (
        <div className="border border-emerald-300/40 bg-emerald-300/5 p-3 text-sm">
          <p className="break-all text-xs text-stone">{state.url}</p>
          <div className="mt-2 flex gap-4 text-[0.62rem] tracking-[0.18em] uppercase">
            <button type="button" onClick={() => navigator.clipboard.writeText(state.url ?? "")} className="text-brass hover:text-ivory">Copiar</button>
            <a href={`https://wa.me/?text=${encodeURIComponent(msg)}`} target="_blank" rel="noreferrer" className="text-brass hover:text-ivory">Enviar por WhatsApp</a>
          </div>
          <p className="mt-2 text-xs text-stone">Al pagarse, el reloj queda reservado solo (también en la web) y te llega aviso por Telegram.</p>
        </div>
      )}
    </form>
  );
}
