"use client";

import { useRef, useState, useTransition } from "react";
import { readCardAction } from "@/app/admin/inventory-actions";
import { useTr } from "@/components/admin/AdminLang";

// Reduce la foto en el navegador (las del móvil pesan varios MB) a JPEG de ~1600 px
async function shrink(file: File) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85).split(",")[1];
}

// Cambia el valor de un campo como si lo escribiera el usuario (así también lo ven los campos con estado)
function setField(form: HTMLFormElement, name: string, value: string | null | undefined) {
  if (!value) return false;
  const el = form.elements.namedItem(name) as HTMLInputElement | null;
  if (!el) return false;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}

// 📷 Leer la tarjeta de garantía: rellena marca, modelo, referencia, serial y fecha de papeles
export function WarrantyScan() {
  const tr = useTr();
  const ref = useRef<HTMLDivElement>(null);
  const [msg, setMsg] = useState<{ ok?: string; warn?: string } | null>(null);
  const [pending, start] = useTransition();

  const onFile = (file: File | undefined) => {
    if (!file) return;
    start(async () => {
      setMsg(null);
      try {
        const base64 = await shrink(file);
        const r = await readCardAction({ base64, mediaType: "image/jpeg" });
        if ("error" in r) return setMsg({ warn: r.error });
        const c = r.card;
        const form = ref.current?.closest("form");
        if (!form) return;
        const filled = [
          setField(form, "brand", c.brand) && tr("marca"),
          setField(form, "model", c.model) && tr("modelo"),
          setField(form, "reference", c.reference) && tr("referencia"),
          setField(form, "serial", c.serial) && tr("serial"),
          setField(form, "papers_date", c.papers_date && /^\d{4}-\d{2}-\d{2}$/.test(c.papers_date) ? c.papers_date : null) && tr("fecha de papeles"),
        ].filter(Boolean);
        const comes = form.elements.namedItem("comes_with") as HTMLInputElement | null;
        if (comes && !/papel|paper/i.test(comes.value)) setField(form, "comes_with", [comes.value, "Papers"].filter(Boolean).join(", "));
        setMsg({
          ok: filled.length ? `${tr("Rellenado:")} ${filled.join(", ")}. ${c.notes}` : c.notes,
          warn: c.doubtful.length ? tr("Revisa a mano: {f} (no se leía con seguridad).", { f: c.doubtful.join(", ") }) : undefined,
        });
      } catch {
        setMsg({ warn: tr("No se pudo leer la tarjeta. Prueba con otra foto, de frente y sin reflejos.") });
      }
    });
  };

  return (
    <div ref={ref} className="flex flex-wrap items-center gap-3 border border-dashed border-brass/40 p-3 text-sm">
      <label className={`cursor-pointer border border-brass/50 px-4 py-2 text-[0.66rem] tracking-[0.2em] uppercase text-brass hover:bg-brass/10 ${pending ? "pointer-events-none opacity-60" : ""}`}>
        {pending ? tr("Leyendo la tarjeta…") : tr("📷 Leer tarjeta de garantía")}
        <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
      </label>
      <span className="text-xs text-stone">{tr("Haz una foto a la tarjeta o los papeles y relleno marca, referencia, serial y fecha.")}</span>
      {msg?.ok && <p className="w-full text-xs text-emerald-200">{msg.ok}</p>}
      {msg?.warn && <p className="w-full text-xs text-amber-200">{msg.warn}</p>}
    </div>
  );
}
