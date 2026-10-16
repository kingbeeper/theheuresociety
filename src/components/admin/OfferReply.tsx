"use client";

import { useState, useTransition } from "react";
import { sendOfferAction } from "@/app/admin/actions";
import { useTr } from "@/components/admin/AdminLang";

const small = "border px-2.5 py-1 text-[0.6rem] tracking-[0.14em] uppercase";

// Enviar nuestra oferta por WhatsApp: un botón por importe sugerido (o uno a mano). La oferta queda
// «Ofertada» con ese importe y se abre WhatsApp con el mensaje escrito en el idioma del cliente.
export function OfferReply({ id, amounts, defaultLang, hasPhone }: { id: string; amounts: { amount: number; label: string }[]; defaultLang: "es" | "en"; hasPhone: boolean }) {
  const tr = useTr();
  const [lang, setLang] = useState(defaultLang);
  const [custom, setCustom] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function send(amount: number) {
    // La ventana se abre ya (si se abre después de esperar, el navegador la bloquea)
    const w = hasPhone ? window.open("", "_blank") : null;
    start(async () => {
      const r = await sendOfferAction(id, amount, lang);
      if ("error" in r) {
        w?.close();
        return setMsg(tr(r.error ?? ""));
      }
      if (r.wa && w) w.location.href = r.wa;
      else {
        w?.close();
        await navigator.clipboard?.writeText(r.text).catch(() => {});
        setMsg(tr("Sin teléfono: copié el mensaje para que lo pegues donde quieras."));
        return;
      }
      setMsg(tr("Oferta enviada: queda como «Ofertada»."));
    });
  }

  const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
  return (
    <div className="mt-2 grid gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {amounts.map((a) => (
          <button key={a.amount} type="button" disabled={pending} onClick={() => send(a.amount)} className={`${small} border-emerald-300/40 text-emerald-200 hover:bg-emerald-300/10 disabled:opacity-50`}>
            📲 {usd(a.amount)} <span className="text-stone">{a.label}</span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <input value={custom} onChange={(e) => setCustom(e.target.value)} inputMode="numeric" placeholder={tr("Otro importe $")} className="w-28 border border-line bg-ink/60 px-2 py-1 text-xs" />
        <button type="button" disabled={pending || !Number(custom.replace(/[^\d.]/g, ""))} onClick={() => send(Number(custom.replace(/[^\d.]/g, "")))} className={`${small} border-line text-stone hover:text-ivory disabled:opacity-50`}>
          {tr("📲 Enviar oferta")}
        </button>
        <select value={lang} onChange={(e) => setLang(e.target.value as "es" | "en")} className="border border-line bg-ink/60 px-1.5 py-1 text-xs" aria-label={tr("Idioma del mensaje")}>
          <option value="es">ES</option>
          <option value="en">EN</option>
        </select>
      </div>
      {msg && <p className="text-xs text-emerald-200">{msg}</p>}
    </div>
  );
}
