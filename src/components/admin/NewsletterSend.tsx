"use client";

import { useActionState } from "react";
import { sendNewsletterAction } from "@/app/admin/newsletter-actions";

const field =
  "w-full border border-line bg-ink/60 px-3 py-2.5 text-sm text-ivory placeholder:text-stone/50 outline-none transition-colors focus:border-brass/70";
const label = "mb-1.5 block text-[0.62rem] tracking-[0.22em] uppercase text-stone";

export function NewsletterSend({ ids, byBrand, count, introEn, introEs, configured }: { ids: string[]; byBrand: boolean; count: number; introEn: string; introEs: string; configured: boolean }) {
  const [state, action, pending] = useActionState(sendNewsletterAction, null);
  return (
    <form action={action} className="grid gap-4">
      {ids.map((id) => <input key={id} type="hidden" name="w" value={id} />)}
      <input type="hidden" name="marca" value={byBrand ? "1" : "0"} />
      <div className="grid gap-4 sm:grid-cols-2">
        <label><span className={label}>Asunto (español)</span><input name="subject_es" defaultValue="Nuevas llegadas · The Heure Society" className={field} /></label>
        <label><span className={label}>Asunto (inglés)</span><input name="subject_en" defaultValue="New arrivals · The Heure Society" className={field} /></label>
        <label><span className={label}>Texto (español)</span><textarea name="intro_es" rows={4} defaultValue={introEs} className={field} /></label>
        <label><span className={label}>Texto (inglés)</span><textarea name="intro_en" rows={4} defaultValue={introEn} className={field} /></label>
      </div>
      <p className="text-xs text-stone">Cada cliente lo recibe en su idioma (español si así figura en su ficha; si no, inglés).</p>
      <label className="flex items-center gap-2 text-sm text-stone">
        <input name="confirm" type="checkbox" className="h-4 w-4" /> Confirmo el envío a {count} cliente(s)
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button name="mode" value="test" disabled={pending || !configured || !ids.length} className="border border-line px-5 py-2.5 text-[0.68rem] tracking-[0.22em] uppercase text-stone hover:text-ivory disabled:opacity-50">
          Enviarme una prueba
        </button>
        <button name="mode" value="all" disabled={pending || !configured || !ids.length || !count} className="bg-ivory px-5 py-2.5 text-[0.68rem] tracking-[0.22em] uppercase text-ink hover:bg-brass disabled:opacity-50">
          {pending ? "Enviando…" : `Enviar a ${count} cliente(s)`}
        </button>
        {state && "error" in state && <p className="text-sm text-red-200/90">{state.error}</p>}
        {state && "ok" in state && <p className="text-sm text-emerald-200/90">{state.ok}</p>}
      </div>
    </form>
  );
}
