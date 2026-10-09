"use client";

import { useState } from "react";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/app/[lang]/dictionaries";
import { sendLead } from "@/lib/lead-client";

// «¿Busca una pieza concreta?»: genera leads de compradores. Cuando se publica un reloj que encaja
// con la búsqueda, el robot de Telegram avisa al equipo de a quién escribir.
export function AlertForm({ lang, dict, initialQuery = "" }: { lang: Locale; dict: Dictionary; initialQuery?: string }) {
  const t = dict.alert;
  const [form, setForm] = useState({ query: initialQuery, budget: "", name: "", phone: "", email: "", website: "" });
  const [state, setState] = useState<"idle" | "sending" | "done" | "error" | "missing">("idle");
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.query.trim() || !form.name.trim() || (!form.phone.trim() && !form.email.trim())) return setState("missing");
    setState("sending");
    const res = await sendLead({ type: "alert", lang, ...form });
    setState(res.ok ? "done" : "error");
  }

  const field =
    "w-full border-b border-line bg-transparent px-1 py-3 text-sm text-ivory placeholder:text-stone/50 outline-none transition-colors focus:border-brass";
  const label = "block text-[0.66rem] tracking-[0.22em] uppercase text-stone";

  return (
    <section className="mx-auto max-w-3xl px-5 py-24 text-center md:py-28">
      <div className="mx-auto flex max-w-xs items-center gap-4" aria-hidden>
        <span className="h-px flex-1 bg-gradient-to-r from-transparent to-brass/70" />
        <span className="h-1.5 w-1.5 rotate-45 bg-brass" />
        <span className="h-px flex-1 bg-gradient-to-l from-transparent to-brass/70" />
      </div>
      <p className="eyebrow mt-10">{t.eyebrow}</p>
      <h2 className="mt-4 font-display text-4xl font-light md:text-5xl">{t.title}</h2>
      <p className="mx-auto mt-5 max-w-lg leading-relaxed text-stone">{t.lead}</p>

      {state === "done" ? (
        <p className="mx-auto mt-12 max-w-md font-display text-2xl font-light italic text-brass">{t.done}</p>
      ) : (
        <form onSubmit={submit} className="mx-auto mt-12 grid max-w-2xl gap-x-8 gap-y-7 text-left sm:grid-cols-2" noValidate>
          <label className="sm:col-span-2">
            <span className={label}>{t.query}</span>
            <input className={field} value={form.query} onChange={set("query")} placeholder={t.queryPh} required />
          </label>
          <label>
            <span className={label}>{t.name}</span>
            <input className={field} value={form.name} onChange={set("name")} autoComplete="name" required />
          </label>
          <label>
            <span className={label}>{t.budget}</span>
            <input className={field} value={form.budget} onChange={set("budget")} inputMode="numeric" />
          </label>
          <label>
            <span className={label}>{t.phone}</span>
            <input className={field} value={form.phone} onChange={set("phone")} type="tel" autoComplete="tel" />
          </label>
          <label>
            <span className={label}>{t.email}</span>
            <input className={field} value={form.email} onChange={set("email")} type="email" autoComplete="email" />
          </label>
          {/* Trampa para bots: invisible para las personas */}
          <input className="hidden" tabIndex={-1} autoComplete="off" value={form.website} onChange={set("website")} aria-hidden />

          <div className="text-center sm:col-span-2">
            {(state === "missing" || state === "error") && (
              <p className="mb-5 text-sm text-red-200/90">{state === "missing" ? t.missing : t.error}</p>
            )}
            <button
              type="submit"
              disabled={state === "sending"}
              className="bg-ivory px-8 py-4 text-[0.72rem] tracking-[0.24em] uppercase text-ink transition-colors hover:bg-brass disabled:opacity-60"
            >
              {state === "sending" ? t.sending : t.submit}
            </button>
            <p className="mt-4 text-xs text-stone/70">{t.privacy}</p>
          </div>
        </form>
      )}
    </section>
  );
}
