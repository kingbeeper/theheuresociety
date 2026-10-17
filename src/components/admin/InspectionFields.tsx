"use client";

import { useState, useTransition } from "react";
import { uploadInspectionPhotoAction } from "@/app/admin/document-actions";
import { INSPECTION_PARTS, PART_LABEL, STATE_LABEL, type Inspection, type PartState } from "@/lib/doc-labels";
import { useAdminLang, useTr } from "@/components/admin/AdminLang";

const field = "w-full border border-line bg-ink/60 px-2 py-2 text-sm text-ivory outline-none focus:border-brass/70";
const label = "mb-1.5 block text-[0.62rem] tracking-[0.22em] uppercase text-stone";

async function shrink(file: File) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return { base64: canvas.toDataURL("image/jpeg", 0.82).split(",")[1], preview: canvas.toDataURL("image/jpeg", 0.5) };
}

// Ficha de inspección: estado de cada parte, si funciona, marcha, set y fotos (privadas)
export function InspectionFields({ value, token }: { value?: Inspection | null; token?: string | null }) {
  const tr = useTr();
  const lang = useAdminLang();
  const parts = PART_LABEL[lang];
  const states = STATE_LABEL[lang];
  const [photos, setPhotos] = useState<{ path: string; preview: string }[]>((value?.photos ?? []).map((path, i) => ({ path, preview: token ? `/api/insp-photo?t=${token}&i=${i}` : "" })));
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const add = (files: FileList | null) => {
    if (!files?.length) return;
    start(async () => {
      setErr(null);
      for (const f of [...files].slice(0, 12 - photos.length)) {
        try {
          const s = await shrink(f);
          const r = await uploadInspectionPhotoAction(s.base64);
          if ("error" in r) setErr(r.error ?? "");
          else setPhotos((p) => [...p, { path: r.path, preview: s.preview }]);
        } catch {
          setErr(tr("No se pudo subir una foto."));
        }
      }
    });
  };

  return (
    <div className="grid gap-4 border border-brass/30 p-4">
      <input type="hidden" name="insp_photos" value={JSON.stringify(photos.map((p) => p.path))} />
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2"><input type="radio" name="insp_dir" value="in" defaultChecked={(value?.direction ?? "in") === "in"} /> {tr("Lo recibimos de su dueño")}</label>
        <label className="flex items-center gap-2"><input type="radio" name="insp_dir" value="out" defaultChecked={value?.direction === "out"} /> {tr("Lo entregamos")}</label>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {INSPECTION_PARTS.map((p) => (
          <label key={p}>
            <span className={label}>{parts[p]}</span>
            <select name={`insp_${p}`} defaultValue={value?.parts?.[p] ?? "ok"} className={field}>
              {(Object.keys(states) as PartState[]).map((s) => <option key={s} value={s}>{states[s]}</option>)}
            </select>
          </label>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <label>
          <span className={label}>{tr("Funciona")}</span>
          <select name="insp_runs" defaultValue={value?.runs === false ? "no" : value?.runs === null ? "" : "yes"} className={field}>
            <option value="yes">{tr("Sí")}</option>
            <option value="no">{tr("No")}</option>
            <option value="">{tr("Sin comprobar")}</option>
          </select>
        </label>
        <label><span className={label}>{tr("Marcha (s/día)")}</span><input name="insp_rate" defaultValue={value?.rate ?? ""} placeholder="+2" className={field} /></label>
        <label><span className={label}>{tr("Reserva de marcha")}</span><input name="insp_power" defaultValue={value?.power_reserve ?? ""} placeholder="70 h" className={field} /></label>
        <label><span className={label}>{tr("Eslabones")}</span><input name="insp_links" defaultValue={value?.links ?? ""} placeholder={tr("Completo, +2…")} className={field} /></label>
      </div>
      <div className="flex flex-wrap items-center gap-5 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" name="insp_box" defaultChecked={value?.box ?? false} className="h-4 w-4" /> {tr("Caja")}</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="insp_papers" defaultChecked={value?.papers ?? false} className="h-4 w-4" /> {tr("Papeles")}</label>
        <input name="insp_extras" defaultValue={value?.extras ?? ""} placeholder={tr("Otros (etiquetas, manual, eslabones sueltos…)")} className={`${field} min-w-56 flex-1`} />
      </div>
      <label><span className={label}>{tr("Observaciones")}</span><textarea name="insp_notes" rows={2} defaultValue={value?.notes ?? ""} placeholder={tr("Rayones finos en el cierre, bisel con marca a las 3…")} className={field} /></label>
      <div>
        <span className={label}>{tr("Fotos (hasta 12, privadas)")}</span>
        <div className="flex flex-wrap items-center gap-2">
          {photos.map((p, i) => (
            <span key={p.path} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {p.preview ? <img src={p.preview} alt="" className="h-16 w-16 border border-line object-cover" /> : <span className="flex h-16 w-16 items-center justify-center border border-line text-xs text-stone">{i + 1}</span>}
              <button type="button" onClick={() => setPhotos(photos.filter((x) => x.path !== p.path))} className="absolute -right-1 -top-1 bg-ink px-1 text-xs text-stone hover:text-red-200" aria-label={tr("Quitar")}>✕</button>
            </span>
          ))}
          {photos.length < 12 && (
            <label className={`cursor-pointer border border-line px-3 py-2 text-[0.62rem] tracking-[0.18em] uppercase text-stone hover:text-ivory ${pending ? "pointer-events-none opacity-60" : ""}`}>
              {pending ? tr("Subiendo…") : tr("📷 Añadir fotos")}
              <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => add(e.target.files)} />
            </label>
          )}
        </div>
        {err && <p className="mt-1 text-xs text-amber-200">{err}</p>}
      </div>
    </div>
  );
}
