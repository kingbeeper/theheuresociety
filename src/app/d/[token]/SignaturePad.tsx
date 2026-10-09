"use client";

import { useEffect, useRef, useState } from "react";

// Firma con el dedo o el ratón, en el enlace del documento
const T = {
  en: {
    title: "Sign this document", name: "Full name", accept: "I have read and agree to the terms of this document and sign it electronically.",
    clear: "Clear", sign: "Sign", signing: "Signing…", draw: "Sign here", need: "Please write your name, sign in the box and accept the terms.",
  },
  es: {
    title: "Firmar este documento", name: "Nombre completo", accept: "He leído y acepto los términos de este documento y lo firmo electrónicamente.",
    clear: "Borrar", sign: "Firmar", signing: "Firmando…", draw: "Firme aquí", need: "Escriba su nombre, firme en el recuadro y acepte los términos.",
  },
};

export function SignaturePad({ token, lang, defaultName }: { token: string; lang: "en" | "es"; defaultName: string }) {
  const t = T[lang];
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [drawn, setDrawn] = useState(false);
  const [name, setName] = useState(defaultName);
  const [accept, setAccept] = useState(false);
  const [state, setState] = useState<"idle" | "sending" | "error">("idle");
  const [error, setError] = useState("");

  // Lienzo a la resolución real de la pantalla (trazo nítido en móviles)
  useEffect(() => {
    const c = canvas.current!;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.offsetWidth * ratio;
    c.height = c.offsetHeight * ratio;
    const ctx = c.getContext("2d")!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#1b1f1c";
  }, []);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const { x, y } = point(e);
    const ctx = canvas.current!.getContext("2d")!;
    ctx.beginPath();
    ctx.moveTo(x, y);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const { x, y } = point(e);
    const ctx = canvas.current!.getContext("2d")!;
    ctx.lineTo(x, y);
    ctx.stroke();
    setDrawn(true);
  };
  const up = () => (drawing.current = false);
  const clear = () => {
    const c = canvas.current!;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    setDrawn(false);
  };

  const submit = async () => {
    if (!drawn || !accept || name.trim().length < 2) {
      setError(t.need);
      return;
    }
    setState("sending");
    const res = await fetch("/api/sign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, name: name.trim(), accept, image: canvas.current!.toDataURL("image/png") }),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (json.ok) return window.location.reload();
    setState("error");
    setError(json.error ?? "Error");
  };

  return (
    <section className="mt-8 border border-[#d8d2c4] bg-white p-6 print:hidden">
      <p className="text-[0.62rem] tracking-[0.24em] uppercase text-[#8a7a52]">{t.title}</p>
      <label className="mt-4 block">
        <span className="mb-1 block text-xs text-[#5d625e]">{t.name}</span>
        <input value={name} onChange={(e) => setName(e.target.value)} className="w-full border border-[#d8d2c4] px-3 py-2 text-sm outline-none focus:border-[#8a7a52]" />
      </label>
      <div className="relative mt-4">
        <canvas
          ref={canvas}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          className="h-40 w-full touch-none border border-dashed border-[#bdb5a3] bg-[#fbfaf7]"
        />
        {!drawn && <span className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-[#a39d8f]">{t.draw}</span>}
      </div>
      <button type="button" onClick={clear} className="mt-2 text-xs text-[#5d625e] underline">{t.clear}</button>
      <label className="mt-4 flex items-start gap-2 text-xs text-[#4a4f4b]">
        <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} className="mt-0.5 h-4 w-4" />
        {t.accept}
      </label>
      <div className="mt-4 flex items-center gap-4">
        <button type="button" onClick={submit} disabled={state === "sending"} className="bg-[#1b1f1c] px-6 py-2.5 text-[0.68rem] tracking-[0.22em] uppercase text-white hover:bg-[#3a4a40] disabled:opacity-60">
          {state === "sending" ? t.signing : t.sign}
        </button>
        {error && <p className="text-xs text-red-700">{error}</p>}
      </div>
    </section>
  );
}
