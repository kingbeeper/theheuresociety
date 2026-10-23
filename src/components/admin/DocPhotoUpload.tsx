"use client";

import { useState, useTransition } from "react";
import { addDocPhotosAction, uploadInspectionPhotoAction } from "@/app/admin/document-actions";
import { shrink } from "@/components/admin/InspectionFields";
import { useTr } from "@/components/admin/AdminLang";

// Subir fotos de la pieza directamente al contrato de compra o consignación
export function DocPhotoUpload({ docId }: { docId: string }) {
  const tr = useTr();
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const upload = (files: FileList | null) => {
    if (!files?.length) return;
    setErr(null);
    start(async () => {
      const paths: string[] = [];
      for (const f of [...files]) {
        try {
          const r = await uploadInspectionPhotoAction((await shrink(f)).base64);
          if ("error" in r) setErr(r.error ?? "");
          else paths.push(r.path);
        } catch {
          setErr(tr("No se pudo subir una foto."));
        }
      }
      if (paths.length) await addDocPhotosAction(docId, paths);
    });
  };

  return (
    <label className={`cursor-pointer border border-line px-4 py-2 text-[0.66rem] tracking-[0.2em] uppercase text-stone hover:text-ivory ${pending ? "pointer-events-none opacity-60" : ""}`}>
      {pending ? tr("Subiendo…") : tr("📷 Subir fotos")}
      <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
      {err && <span className="ml-2 normal-case tracking-normal text-red-200">{err}</span>}
    </label>
  );
}
