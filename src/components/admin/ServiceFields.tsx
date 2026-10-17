"use client";

import { useState, useTransition } from "react";
import { uploadInspectionPhotoAction } from "@/app/admin/document-actions";
import { SERVICE_STATUS, type ServiceOrder } from "@/lib/doc-labels";
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
  return { base64: canvas.toDataURL("image/jpeg", 0.82).split(",")[1], preview: canvas.toDataURL("image/jpeg", 0.5) };
}

// Orden de servicio: la pieza que deja el cliente (con fotos), el taller y lo que cobra el taller
export function ServiceFields({ value, token, showCosts }: { value?: ServiceOrder | null; token?: string | null; showCosts: boolean }) {
  const tr = useTr();
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
      <input type="hidden" name="svc_photos" value={JSON.stringify(photos.map((p) => p.path))} />
      {value?.status && <p className="text-sm text-stone">{tr("Estado")}: <span className="text-brass">{tr(SERVICE_STATUS[value.status])}</span></p>}
      <label>
        <span className={label}>{tr("Pieza que deja el cliente *")}</span>
        <input name="svc_piece" required defaultValue={value?.piece ?? ""} placeholder={tr("Cadena oro 14k amarillo, 20 in, cierre roto")} className={field} />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label><span className={label}>{tr("Taller (joyero o relojero)")}</span><input name="svc_provider" defaultValue={value?.provider ?? ""} className={field} /></label>
        {showCosts ? (
          <label><span className={label}>{tr("Lo que nos cobra el taller (USD)")}</span><input name="svc_cost" inputMode="decimal" defaultValue={value?.provider_cost ?? ""} className={field} /></label>
        ) : (
          <input type="hidden" name="svc_cost" value={value?.provider_cost ?? ""} />
        )}
      </div>
      <p className="text-xs text-stone">{tr("En «Relojes y conceptos» pon el trabajo y lo que paga el cliente (ej. «Pulido y reparación de cierre» · $120). La fecha de «Lista para» es la que le prometes.")}</p>
      <div>
        <span className={label}>{tr("Fotos de la pieza al recibirla (privadas)")}</span>
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
