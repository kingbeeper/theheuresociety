"use client";

import { useState, useTransition } from "react";
import { uploadInspectionPhotoAction } from "@/app/admin/document-actions";
import type { SellerDetails } from "@/lib/doc-labels";
import { useTr } from "@/components/admin/AdminLang";

const field = "w-full border border-line bg-ink/60 px-2 py-2 text-sm text-ivory outline-none focus:border-brass/70";
const label = "mb-1.5 block text-[0.62rem] tracking-[0.22em] uppercase text-stone";

async function shrink(file: File) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85).split(",")[1];
}

// Datos del vendedor para el registro de compras de segunda mano (solo en el CRM, no salen en el documento)
export function SellerRegistry({ value }: { value?: SellerDetails | null }) {
  const tr = useTr();
  const [thumb, setThumb] = useState(value?.thumb_path ?? "");
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const upload = (f: File | undefined) =>
    f &&
    start(async () => {
      setErr(null);
      const r = await uploadInspectionPhotoAction(await shrink(f)).catch(() => ({ error: tr("No se pudo subir una foto.") }));
      if ("error" in r) setErr(r.error ?? "");
      else setThumb(r.path);
    });
  const fields: [string, keyof SellerDetails, string][] = [
    ["sd_sex", "sex", tr("Sexo")],
    ["sd_race", "race", tr("Raza")],
    ["sd_height", "height", tr("Altura")],
    ["sd_weight", "weight", tr("Peso")],
    ["sd_hair", "hair", tr("Color de pelo")],
    ["sd_eyes", "eyes", tr("Color de ojos")],
  ];
  return (
    <div className="grid gap-3 border border-line/70 p-3 sm:col-span-3">
      <p className="text-[0.62rem] tracking-[0.22em] uppercase text-brass">{tr("Registro de compras de segunda mano (Florida)")}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        {fields.map(([name, key, l]) => (
          <label key={name}><span className={label}>{l}</span><input name={name} defaultValue={(value?.[key] as string | null) ?? ""} className={field} /></label>
        ))}
      </div>
      <input type="hidden" name="sd_thumb" value={thumb} />
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className={`cursor-pointer border border-line px-3 py-2 text-[0.62rem] tracking-[0.18em] uppercase text-stone hover:text-ivory ${pending ? "pointer-events-none opacity-60" : ""}`}>
          {pending ? tr("Subiendo…") : thumb ? tr("✓ Huella guardada · cambiar") : tr("👍 Foto de la huella del pulgar derecho")}
          <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
        </label>
        {err && <span className="text-xs text-amber-200">{err}</span>}
      </div>
      <p className="text-xs text-stone">{tr("La dirección es la del vendedor (arriba). Estos datos y la huella quedan solo en el CRM: no salen en el contrato que firma.")}</p>
    </div>
  );
}
