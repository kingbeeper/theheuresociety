"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

// Botón «Importar Excel»: sube la hoja INVENTORY CONTROL (.xlsx) y la carga en el inventario
export function ImportInventory() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function upload(file: File) {
    setBusy(true);
    setMsg("Importando…");
    const body = new FormData();
    body.append("file", file);
    const res = await fetch("/api/inventory/import", { method: "POST", body });
    const j = (await res.json().catch(() => ({}))) as { ok?: boolean; created?: number; skipped?: number; notes?: string[]; error?: string };
    setBusy(false);
    setMsg(
      j.ok
        ? `${j.created} reloj(es) importados${j.skipped ? ` · ${j.skipped} ya estaban (mismo número de serie)` : ""}${j.notes?.length ? ` · ${j.notes.length} fila(s) con error` : ""}`
        : j.error ?? "No se pudo importar."
    );
    if (input.current) input.current.value = "";
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2">
      {msg && <span className="text-xs text-stone">{msg}</span>}
      <input ref={input} type="file" accept=".xlsx" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      <button
        type="button"
        disabled={busy}
        onClick={() => input.current?.click()}
        className="border border-line px-4 py-2 text-[0.66rem] tracking-[0.2em] uppercase text-stone hover:border-ivory/40 hover:text-ivory disabled:opacity-50"
      >
        Importar Excel
      </button>
    </div>
  );
}
