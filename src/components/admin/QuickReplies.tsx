"use client";

import { useState } from "react";
import { useTr } from "@/components/admin/AdminLang";

type T = { title: string; body_es: string; body_en: string };
type W = { id: string; label: string; price: number | null; slug: string | null };

const fill = (body: string, vars: Record<string, string>) => body.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);
const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

// 💬 Respuestas rápidas: plantillas de WhatsApp con el nombre del cliente y el reloj ya puestos
export function QuickReplies({ templates, watches, name, phone, defaultLang, payInfo, site }: { templates: T[]; watches: W[]; name: string; phone: string | null; defaultLang: "es" | "en"; payInfo: string; site: string }) {
  const tr = useTr();
  const [lang, setLang] = useState(defaultLang);
  const [watchId, setWatchId] = useState("");
  const [copied, setCopied] = useState<number | null>(null);
  const w = watches.find((x) => x.id === watchId);
  const vars: Record<string, string> = {
    nombre: name.split(" ")[0],
    ...(w && { reloj: w.label }),
    ...(w?.price && { precio: usd(w.price) }),
    ...(w?.slug && { enlace: `${site}/${lang}/watches/${w.slug}` }),
    ...(payInfo && { pago: payInfo }),
  };
  const missing = (body: string) => [...body.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).filter((k) => !vars[k]);
  const label: Record<string, string> = { reloj: tr("elige un reloj"), precio: tr("el reloj no tiene precio"), enlace: tr("el reloj no está publicado en la web"), pago: tr("faltan los datos de pago en Documentos → Ajustes"), nombre: tr("falta el nombre") };

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        <select value={watchId} onChange={(e) => setWatchId(e.target.value)} className="min-w-0 flex-1 border border-line bg-ink/60 px-2 py-1.5 text-xs">
          <option value="">{tr("— Reloj (opcional) —")}</option>
          {watches.map((x) => <option key={x.id} value={x.id}>{x.label}{x.price ? ` · ${usd(x.price)}` : ""}</option>)}
        </select>
        <select value={lang} onChange={(e) => setLang(e.target.value as "es" | "en")} aria-label={tr("Idioma del mensaje")} className="border border-line bg-ink/60 px-2 py-1.5 text-xs">
          <option value="es">ES</option>
          <option value="en">EN</option>
        </select>
      </div>
      <ul className="grid gap-1.5">
        {templates.map((t, i) => {
          const body = lang === "en" ? t.body_en : t.body_es;
          const miss = missing(body);
          const text = fill(body, vars);
          return (
            <li key={i} className="flex flex-wrap items-center justify-between gap-2 border-b border-line/60 pb-1.5 text-sm">
              <span className="min-w-0">
                {t.title}
                {miss.length > 0 && <span className="block text-xs text-amber-200">{miss.map((k) => label[k] ?? `{${k}}`).join(" · ")}</span>}
              </span>
              <span className="flex gap-1.5">
                {phone && !miss.length && (
                  <a href={`https://wa.me/${phone}?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer" className="border border-emerald-300/40 px-2 py-1 text-[0.6rem] tracking-[0.14em] uppercase text-emerald-200 hover:bg-emerald-300/10">📲 WhatsApp</a>
                )}
                <button
                  type="button"
                  disabled={miss.length > 0}
                  onClick={() => navigator.clipboard?.writeText(text).then(() => setCopied(i))}
                  className="border border-line px-2 py-1 text-[0.6rem] tracking-[0.14em] uppercase text-stone hover:text-ivory disabled:opacity-40"
                >
                  {copied === i ? tr("✓ Copiado") : tr("Copiar")}
                </button>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
