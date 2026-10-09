"use client";

import { useTransition } from "react";
import { STAGES, STAGE_LABEL, type Stage } from "@/lib/crm-labels";
import { setStage } from "@/app/admin/actions";

// Cambiar la etapa de un lead desde la lista, sin abrir la ficha
export function StageSelect({ id, stage }: { id: string; stage: Stage }) {
  const [pending, start] = useTransition();
  return (
    <select
      defaultValue={stage}
      disabled={pending}
      onChange={(e) => start(() => setStage(id, e.target.value as Stage))}
      className="border border-line bg-ink px-2 py-1.5 text-xs text-ivory outline-none focus:border-brass disabled:opacity-50"
      aria-label="Etapa"
    >
      {STAGES.map((s) => (
        <option key={s} value={s}>
          {STAGE_LABEL[s]}
        </option>
      ))}
    </select>
  );
}
