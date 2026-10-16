"use client";

import { useFormStatus } from "react-dom";

// Botón de formulario que muestra un texto mientras la acción trabaja (p. ej. una búsqueda de un minuto)
export function PendingButton({ children, pending, className }: { children: React.ReactNode; pending: string; className?: string }) {
  const { pending: busy } = useFormStatus();
  return (
    <button disabled={busy} className={`${className ?? ""} disabled:opacity-60`}>
      {busy ? pending : children}
    </button>
  );
}
