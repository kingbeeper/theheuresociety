"use client";

import { useState, useTransition } from "react";
import { createOfferAction, offerPhotosAction } from "@/app/admin/actions";

const field = "w-full border border-line bg-ink/60 px-3 py-2.5 text-sm text-ivory placeholder:text-stone/50 outline-none transition-colors focus:border-brass/70";
const label = "mb-1.5 block text-[0.62rem] tracking-[0.22em] uppercase text-stone";

// Registrar a mano un reloj que un cliente nos ofrece (en persona o por teléfono), con sus fotos
export function OfferNew() {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"sell" | "trade" | "consign">("sell");
  const [files, setFiles] = useState<File[]>([]);
  const [msg, setMsg] = useState<{ error?: string; ok?: string } | null>(null);
  const [pending, start] = useTransition();

  if (!open)
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => { setOpen(true); setMsg(null); }} className="bg-ivory px-5 py-2.5 text-[0.68rem] tracking-[0.22em] uppercase text-ink hover:bg-brass">
          + Nueva oferta
        </button>
        {msg?.ok && <p className="text-sm text-emerald-200/90">{msg.ok}</p>}
      </div>
    );

  function submit(form: FormData) {
    const s = (k: string) => String(form.get(k) ?? "").trim();
    start(async () => {
      const r = await createOfferAction({
        kind, name: s("name"), phone: s("phone"), email: s("email"), brand: s("brand"), model: s("model"), reference: s("reference"),
        asking: s("asking"), details: s("details"), photos: files.map((f) => ({ type: f.type })),
      });
      if ("error" in r) return setMsg({ error: r.error });
      // Fotos directamente al almacenamiento con los enlaces firmados
      const done = await Promise.all(
        r.uploads.map(async (u, i) => {
          const body = new FormData();
          body.append("cacheControl", "3600");
          body.append("", files[i]);
          const res = await fetch(u.url, { method: "PUT", body }).catch(() => null);
          return res?.ok ? u.publicUrl : null;
        })
      );
      const urls = done.filter(Boolean) as string[];
      if (urls.length) await offerPhotosAction(r.id, urls);
      setFiles([]);
      setOpen(false);
      setMsg({ ok: `Oferta guardada en «Nuevas»${files.length ? ` con ${urls.length} foto(s)` : ""}.` });
    });
  }

  const opt = (on: boolean) => `border px-3 py-2 text-xs ${on ? "border-brass text-ivory" : "border-line text-stone hover:text-ivory"}`;
  return (
    <form action={submit} className="grid w-full max-w-3xl gap-4 border border-line bg-forest/70 p-5">
      <div className="flex flex-wrap gap-2">
        {(["sell", "trade", "consign"] as const).map((k) => (
          <button key={k} type="button" onClick={() => setKind(k)} className={opt(kind === k)}>
            {{ sell: "Me lo vende", trade: "Lo quiere cambiar", consign: "Lo deja en consignación" }[k]}
          </button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label><span className={label}>Cliente *</span><input name="name" required className={field} /></label>
        <label><span className={label}>Teléfono</span><input name="phone" type="tel" placeholder="+1 305…" className={field} /></label>
        <label><span className={label}>Correo</span><input name="email" type="email" className={field} /></label>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label><span className={label}>Marca *</span><input name="brand" required placeholder="Rolex" className={field} /></label>
        <label><span className={label}>Modelo</span><input name="model" placeholder="Submariner Date" className={field} /></label>
        <label><span className={label}>Referencia</span><input name="reference" placeholder="126610LN" className={field} /></label>
      </div>
      <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
        <label><span className={label}>Cuánto pide</span><input name="asking" placeholder="$14,000" className={field} /></label>
        <label><span className={label}>Detalles</span><input name="details" placeholder="Año, estado, caja y papeles…" className={field} /></label>
      </div>
      <label>
        <span className={label}>Fotos (hasta 10)</span>
        <input type="file" accept="image/*" multiple onChange={(e) => setFiles([...(e.target.files ?? [])].slice(0, 10))} className="text-sm text-stone" />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button disabled={pending} className="bg-ivory px-5 py-2.5 text-[0.68rem] tracking-[0.22em] uppercase text-ink hover:bg-brass disabled:opacity-60">{pending ? "Guardando…" : "Guardar oferta"}</button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-stone underline hover:text-ivory">Cerrar</button>
        {msg?.error && <p className="text-sm text-red-200/90">{msg.error}</p>}
      </div>
    </form>
  );
}
