"use client";

import { useState, useTransition } from "react";
import { uploadInspectionPhotoAction } from "@/app/admin/document-actions";
import { ID_TYPES } from "@/lib/doc-labels";
import { shrink } from "@/components/admin/InspectionFields";
import { SellerRegistry } from "@/components/admin/SellerRegistry";
import { useTr } from "@/components/admin/AdminLang";

const field = "w-full border border-line bg-ink/60 px-3 py-2.5 text-sm text-ivory placeholder:text-stone/50 outline-none transition-colors focus:border-brass/70";
const label = "mb-1.5 block text-[0.62rem] tracking-[0.22em] uppercase text-stone";

// A quién se le compra (compra a un particular): identificación y datos del registro de segunda mano.
// Al guardar la pieza se crea su contrato de compra con estos datos.
export function SellerIdentity() {
  const tr = useTr();
  const [idPhoto, setIdPhoto] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const upload = (f: File | undefined) =>
    f &&
    start(async () => {
      setErr(null);
      const r = await uploadInspectionPhotoAction((await shrink(f)).base64).catch(() => ({ error: tr("No se pudo subir una foto.") }));
      if ("error" in r) setErr(r.error ?? "");
      else setIdPhoto(r.path);
    });
  return (
    <div className="grid grid-cols-1 gap-4 border border-brass/30 p-4">
      <p className="text-[0.66rem] tracking-[0.24em] uppercase text-brass">{tr("A quién le compras (registro de segunda mano)")}</p>
      <div className="grid gap-4 sm:grid-cols-3">
        <label><span className={label}>{tr("Nombre del vendedor")}</span><input name="seller_name" autoComplete="off" className={field} /></label>
        <label><span className={label}>{tr("Teléfono")}</span><input name="seller_phone" type="tel" className={field} /></label>
        <label><span className={label}>{tr("Correo")}</span><input name="seller_email" type="email" className={field} /></label>
        <label className="sm:col-span-3"><span className={label}>{tr("Dirección")}</span><input name="seller_address" placeholder={tr("Calle, ciudad, estado, código postal")} className={field} /></label>
        <label>
          <span className={label}>{tr("Identificación")}</span>
          <select name="seller_id_type" defaultValue="Driver's license" className={field}>
            {ID_TYPES.map((t) => <option key={t} value={t}>{tr(t)}</option>)}
          </select>
        </label>
        <label><span className={label}>{tr("Número")}</span><input name="seller_id_number" autoComplete="off" className={field} /></label>
        <label><span className={label}>{tr("Fecha de nacimiento")}</span><input name="seller_dob" type="date" className={field} /></label>
      </div>
      <input type="hidden" name="seller_id_photo" value={idPhoto} />
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className={`cursor-pointer border border-line px-3 py-2 text-[0.62rem] tracking-[0.18em] uppercase text-stone hover:text-ivory ${pending ? "pointer-events-none opacity-60" : ""}`}>
          {pending ? tr("Subiendo…") : idPhoto ? tr("✓ Foto del ID guardada · cambiar") : tr("🪪 Foto de la licencia o ID")}
          <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
        </label>
        {err && <span className="text-xs text-amber-200">{err}</span>}
      </div>
      {/* Contenedor normal (no grid): SellerRegistry trae sm:col-span-3, que aquí estiraría las columnas */}
      <div><SellerRegistry /></div>
      <p className="text-xs text-stone">{tr("Es opcional: al guardar se crea su contrato de compra con estos datos. Si ya nos vendió antes (mismo teléfono o correo), su identificación se completa sola.")}</p>
    </div>
  );
}
