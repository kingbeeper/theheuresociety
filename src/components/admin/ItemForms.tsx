"use client";

import { useActionState, useState } from "react";
import { ACQUISITION, CONDITIONS, PAYMENT } from "@/lib/stock-labels";
import { returnItem, saveItem, sellItem } from "@/app/admin/inventory-actions";
import type { Item } from "@/lib/stock";

const field =
  "w-full border border-line bg-ink/60 px-3 py-2.5 text-sm text-ivory placeholder:text-stone/50 outline-none transition-colors focus:border-brass/70";
const label = "mb-1.5 block text-[0.62rem] tracking-[0.22em] uppercase text-stone";
const button = "bg-ivory px-5 py-2.5 text-[0.68rem] tracking-[0.22em] uppercase text-ink hover:bg-brass disabled:opacity-60";
const section = "text-[0.66rem] tracking-[0.24em] uppercase text-brass";

type WatchOption = { id: string; label: string };

// Ficha del reloj y de su entrada (mismos datos que la plantilla de Excel, más lo que faltaba)
export function ItemForm({ item, watches }: { item?: Item; watches: WatchOption[] }) {
  const [state, action, pending] = useActionState(saveItem.bind(null, item?.id ?? null), null);
  const [acq, setAcq] = useState(item?.acquisition ?? "purchase");
  const owner = acq === "consignment" || acq === "memo";
  const v = (k: keyof Item) => (item?.[k] ?? "") as string;

  return (
    <form action={action} className="grid gap-6">
      <div className="grid gap-4">
        <p className={section}>Reloj</p>
        <div className="grid gap-4 sm:grid-cols-3">
          <label><span className={label}>Marca *</span><input name="brand" defaultValue={v("brand")} required className={field} /></label>
          <label><span className={label}>Modelo</span><input name="model" defaultValue={v("model")} className={field} /></label>
          <label><span className={label}>Ref #</span><input name="reference" defaultValue={v("reference")} className={field} /></label>
          <label><span className={label}>Serial #</span><input name="serial" defaultValue={v("serial")} className={field} /></label>
          <label><span className={label}>Fecha de papeles</span><input name="papers_date" type="date" defaultValue={v("papers_date")} className={field} /></label>
          <label><span className={label}>Eslabones (Links #)</span><input name="links" defaultValue={v("links")} placeholder="Full links, +2…" className={field} /></label>
          <label>
            <span className={label}>Condición</span>
            <input name="condition" list="conditions" defaultValue={v("condition")} className={field} />
            <datalist id="conditions">{CONDITIONS.map((c) => <option key={c} value={c} />)}</datalist>
          </label>
          <label className="sm:col-span-2"><span className={label}>Incluye (Comes with)</span><input name="comes_with" defaultValue={v("comes_with")} placeholder="Caja, papeles, etiquetas…" className={field} /></label>
        </div>
        <label><span className={label}>Descripción</span><textarea name="description" rows={2} defaultValue={v("description")} className={field} /></label>
      </div>

      <div className="grid gap-4">
        <p className={section}>Entrada</p>
        <div className="grid gap-4 sm:grid-cols-3">
          <label>
            <span className={label}>Cómo entró</span>
            <select name="acquisition" value={acq} onChange={(e) => setAcq(e.target.value as Item["acquisition"])} className={field}>
              {Object.entries(ACQUISITION).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <label><span className={label}>Fecha de entrada</span><input name="purchase_date" type="date" defaultValue={v("purchase_date")} className={field} /></label>
          {acq === "memo" && <label><span className={label}>Devolver antes de</span><input name="memo_due" type="date" defaultValue={v("memo_due")} className={field} /></label>}
          <label><span className={label}>{owner ? "Dueño / dealer (contacto)" : "Proveedor (contacto)"}</span><input name="supplier_name" defaultValue={v("supplier_name")} className={field} /></label>
          <label><span className={label}>Empresa</span><input name="supplier_company" defaultValue={v("supplier_company")} className={field} /></label>
          <label><span className={label}>Ubicación</span><input name="supplier_location" defaultValue={v("supplier_location")} placeholder="Miami, FL" className={field} /></label>
          <label><span className={label}>{owner ? "A pagar al dueño al vender (USD)" : "Costo (USD)"}</span><input name="cost" inputMode="decimal" defaultValue={v("cost")} className={field} /></label>
          <label><span className={label}>Gastos extra (USD)</span><input name="extra_costs" inputMode="decimal" defaultValue={item?.extra_costs ?? ""} placeholder="Servicio, pulido, envío…" className={field} /></label>
          <label><span className={label}>Precio de venta previsto (USD)</span><input name="asking_price" inputMode="decimal" defaultValue={v("asking_price")} className={field} /></label>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label>
          <span className={label}>Ficha en la web</span>
          <select name="watch_id" defaultValue={v("watch_id")} className={field}>
            <option value="">— Sin publicar —</option>
            {watches.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
          </select>
        </label>
        <label><span className={label}>Notas internas</span><input name="notes" defaultValue={v("notes")} className={field} /></label>
      </div>

      <div className="flex items-center gap-4">
        <button disabled={pending} className={button}>{pending ? "Guardando…" : item ? "Guardar cambios" : "Añadir al inventario"}</button>
        {state?.error && <p className="text-sm text-red-200/90">{state.error}</p>}
        {state && "ok" in state && !pending && <p className="text-sm text-emerald-200/90">Guardado</p>}
      </div>
    </form>
  );
}

type CustomerOption = { id: string; label: string };

// Venta: un solo pago. El comprador puede ser un cliente del CRM o uno nuevo.
export function SaleForm({ item, customers, today }: { item: Item; customers: CustomerOption[]; today: string }) {
  const [state, action, pending] = useActionState(sellItem.bind(null, item.id), null);
  const [buyer, setBuyer] = useState("");
  return (
    <form action={action} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <label><span className={label}>Precio de venta (USD) *</span><input name="sale_price" inputMode="decimal" defaultValue={item.asking_price ?? ""} required className={field} /></label>
        <label><span className={label}>Fecha</span><input name="sale_date" type="date" defaultValue={today} className={field} /></label>
        <label>
          <span className={label}>Forma de pago</span>
          <select name="payment_method" className={field} defaultValue="wire">
            {Object.entries(PAYMENT).map(([k, l]) => <option key={k} value={l}>{l}</option>)}
          </select>
        </label>
      </div>
      <label>
        <span className={label}>Comprador</span>
        <select name="buyer_customer_id" value={buyer} onChange={(e) => setBuyer(e.target.value)} className={field}>
          <option value="">— Cliente nuevo —</option>
          {customers.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </label>
      {!buyer && (
        <div className="grid gap-4 sm:grid-cols-3">
          <label><span className={label}>Nombre</span><input name="buyer_name" className={field} /></label>
          <label><span className={label}>Teléfono</span><input name="buyer_phone" className={field} /></label>
          <label><span className={label}>Correo</span><input name="buyer_email" type="email" className={field} /></label>
        </div>
      )}
      <div className="flex items-center gap-4">
        <button disabled={pending} className={button}>{pending ? "Guardando…" : "Registrar venta"}</button>
        {state?.error && <p className="text-sm text-red-200/90">{state.error}</p>}
      </div>
    </form>
  );
}

export function ReturnForm({ item, today }: { item: Item; today: string }) {
  const [, action, pending] = useActionState(returnItem.bind(null, item.id), null);
  const to = item.acquisition === "consignment" ? "al consignatario" : item.acquisition === "memo" ? "al dealer" : "";
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-[160px_1fr_auto] sm:items-end">
      <label><span className={label}>Fecha</span><input name="return_date" type="date" defaultValue={today} className={field} /></label>
      <label><span className={label}>Motivo</span><input name="return_reason" placeholder="Sin vender, el dueño lo retira…" className={field} /></label>
      <button disabled={pending} className="border border-line px-4 py-2.5 text-[0.66rem] tracking-[0.2em] uppercase text-stone hover:border-ivory/40 hover:text-ivory disabled:opacity-60">
        {pending ? "Guardando…" : `Devolver ${to}`.trim()}
      </button>
    </form>
  );
}
