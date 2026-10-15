"use client";

import { useActionState, useState } from "react";
import { returnItem } from "@/app/admin/inventory-actions";

// Devolver desde el listado del inventario, sin salir: el motivo y confirmar en un recuadro
export function QuickReturn({ id, label, today }: { id: string; label: string; today: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(returnItem.bind(null, id), null);
  if (state && "ok" in state)
    return (
      <span className="text-[0.62rem] tracking-[0.16em] uppercase text-stone">
        Devuelto ✓{state.receiptId && <> · <a href={`/admin/documentos/${state.receiptId}`} className="text-brass underline hover:text-ivory">Acta para firmar</a></>}
      </span>
    );
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="whitespace-nowrap border border-line px-2.5 py-1 text-[0.6rem] tracking-[0.16em] uppercase text-stone hover:text-ivory"
      >
        {label}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 px-4" onClick={() => setOpen(false)}>
        <form action={action} onClick={(e) => e.stopPropagation()} className="grid w-full max-w-sm gap-2 border border-line bg-forest p-4 text-left shadow-2xl">
          <p className="text-[0.62rem] tracking-[0.16em] uppercase text-brass">{label}</p>
          <textarea name="return_reason" rows={2} autoFocus placeholder="Motivo (ej. el dueño lo retira, no se vendió en el plazo…)" className="w-full border border-line bg-ink/60 px-2 py-1.5 text-sm text-ivory outline-none focus:border-brass/70" />
          <label className="flex items-center justify-between gap-2 text-xs text-stone">
            Fecha
            <input name="return_date" type="date" defaultValue={today} className="border border-line bg-ink/60 px-2 py-1 text-sm text-ivory" />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className="px-2 py-1 text-xs text-stone hover:text-ivory">Cancelar</button>
            <button disabled={pending} className="bg-ivory px-3 py-1.5 text-[0.62rem] tracking-[0.16em] uppercase text-ink hover:bg-brass disabled:opacity-60">
              {pending ? "Devolviendo…" : "Devolver"}
            </button>
          </div>
          <p className="text-[0.68rem] text-stone/80">Sale del inventario disponible y de la web. Si es de un dueño (consignación o memo), se genera el acta de devolución para que la firme.</p>
        </form>
        </div>
      )}
    </div>
  );
}
