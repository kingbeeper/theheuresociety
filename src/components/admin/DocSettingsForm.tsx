"use client";

import { useActionState } from "react";
import { saveDocumentSettings } from "@/app/admin/document-actions";
import type { DocSettings } from "@/lib/doc-labels";

const field =
  "w-full border border-line bg-ink/60 px-3 py-2.5 text-sm text-ivory placeholder:text-stone/50 outline-none transition-colors focus:border-brass/70";
const label = "mb-1.5 block text-[0.62rem] tracking-[0.22em] uppercase text-stone";

export function DocSettingsForm({ s }: { s: Required<DocSettings> }) {
  const [state, action, pending] = useActionState(saveDocumentSettings, null);
  return (
    <form action={action} className="grid gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <label><span className={label}>Nombre legal de la empresa</span><input name="doc_company" defaultValue={s.doc_company} className={field} /></label>
        <label><span className={label}>EIN / Tax ID (opcional)</span><input name="doc_tax_id" defaultValue={s.doc_tax_id} className={field} /></label>
        <label><span className={label}>Teléfono</span><input name="doc_phone" defaultValue={s.doc_phone} className={field} /></label>
        <label><span className={label}>Correo</span><input name="doc_email" type="email" defaultValue={s.doc_email} className={field} /></label>
        <label><span className={label}>Dirección</span><textarea name="doc_address" rows={2} defaultValue={s.doc_address} className={field} /></label>
        <label><span className={label}>Impuesto de ventas por defecto (%)</span><input name="doc_tax_rate" inputMode="decimal" defaultValue={s.doc_tax_rate} className={field} /></label>
      </div>
      <label>
        <span className={label}>Instrucciones de pago (salen en facturas y cotizaciones)</span>
        <textarea name="doc_payment_info" rows={3} defaultValue={s.doc_payment_info} placeholder="Wire transfer: Bank…, Account name…, Routing…, Account…  ·  Zelle: …" className={field} />
        <span className="mt-1 block text-[0.7rem] text-stone/80">Escríbelas tú aquí: se guardan en tu base de datos y solo salen en los documentos que compartas.</span>
      </label>
      <label>
        <span className={label}>Enlace para dejar una reseña en Google</span>
        <input name="doc_review_url" type="url" defaultValue={s.doc_review_url} placeholder="https://g.page/r/…/review" className={field} />
        <span className="mt-1 block text-[0.7rem] text-stone/80">Va en el mensaje de agradecimiento que se envía a los 7 días de cada venta. Se obtiene en Google Business Profile → «Pedir reseñas».</span>
      </label>
      <label><span className={label}>Términos de las cotizaciones</span><textarea name="doc_terms_quote" rows={3} defaultValue={s.doc_terms_quote} className={field} /></label>
      <label><span className={label}>Términos de los memos</span><textarea name="doc_terms_memo" rows={4} defaultValue={s.doc_terms_memo} className={field} /></label>
      <label><span className={label}>Términos de los contratos de consignación</span><textarea name="doc_terms_consignment" rows={4} defaultValue={s.doc_terms_consignment} className={field} /></label>
      <label><span className={label}>Términos de los contratos de compra</span><textarea name="doc_terms_purchase" rows={4} defaultValue={s.doc_terms_purchase} className={field} /></label>
      <label><span className={label}>Términos de los encargos (anticipo reembolsable)</span><textarea name="doc_terms_sourcing" rows={5} defaultValue={s.doc_terms_sourcing} className={field} /></label>
      <label><span className={label}>Términos de las facturas</span><textarea name="doc_terms_invoice" rows={3} defaultValue={s.doc_terms_invoice} className={field} /></label>
      <p className="text-xs text-stone">Los términos son un punto de partida: conviene que los revise tu abogado o contador.</p>
      <div className="flex items-center gap-4">
        <button disabled={pending} className="bg-ivory px-5 py-2.5 text-[0.68rem] tracking-[0.22em] uppercase text-ink hover:bg-brass disabled:opacity-60">{pending ? "Guardando…" : "Guardar"}</button>
        {state?.ok && !pending && <p className="text-sm text-emerald-200/90">Guardado</p>}
      </div>
    </form>
  );
}
