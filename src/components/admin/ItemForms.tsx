"use client";


import { useTr } from "@/components/admin/AdminLang";
import { useActionState, useState } from "react";
import { ACQUISITION, CATEGORY, CONDITIONS, GOLD_COLORS, JEWELRY_TYPE, METALS, PAYMENT, type Category } from "@/lib/stock-labels";
import { SOURCE_LABEL } from "@/lib/crm-labels";
import { returnItem, saveItem, sellItem } from "@/app/admin/inventory-actions";
import type { Item } from "@/lib/stock";
import { WarrantyScan } from "./WarrantyScan";
import { SellerIdentity } from "./SellerIdentity";
import { SerialInput } from "./SerialCheck";

const field =
  "w-full border border-line bg-ink/60 px-3 py-2.5 text-sm text-ivory placeholder:text-stone/50 outline-none transition-colors focus:border-brass/70";
const label = "mb-1.5 block text-[0.62rem] tracking-[0.22em] uppercase text-stone";
const button = "bg-ivory px-5 py-2.5 text-[0.68rem] tracking-[0.22em] uppercase text-ink hover:bg-brass disabled:opacity-60";
const section = "text-[0.66rem] tracking-[0.24em] uppercase text-brass";

type WatchOption = { id: string; label: string };

// Ficha del reloj y de su entrada (mismos datos que la plantilla de Excel, más lo que faltaba)
export function ItemForm({ item, watches, showCosts = true, prefill }: { item?: Item; watches: WatchOption[]; showCosts?: boolean; prefill?: Partial<Record<keyof Item, string | undefined>> }) {
  const tr = useTr();
  const [state, action, pending] = useActionState(saveItem.bind(null, item?.id ?? null), null);
  const [acq, setAcq] = useState(item?.acquisition ?? "purchase");
  const owner = acq === "consignment" || acq === "memo";
  const v = (k: keyof Item) => (item?.[k] ?? prefill?.[k] ?? "") as string;
  // Compra de segunda mano a un particular: se deduce del proveedor (con empresa = no) salvo que se marque a mano
  const [company, setCompany] = useState(v("supplier_company"));
  // La fecha de papeles solo se pide si la pieza trae papeles (o ya tiene una fecha guardada)
  const [comesWith, setComesWith] = useState(v("comes_with"));
  const hasPapers = /papel|paper|tarjeta|card|garant|warrant/i.test(comesWith) || Boolean(v("papers_date"));
  const [shOverride, setShOverride] = useState<boolean | null>(item ? Boolean(item.hold_until) : null);
  const secondhand = shOverride ?? !company.trim();
  const [cat, setCat] = useState<Category>(item?.category ?? (prefill?.category as Category | undefined) ?? "watch");
  const j = item?.jewelry ?? null;

  return (
    <form action={action} className="grid gap-6">
      <div className="grid gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="category" value={cat} />
          {(Object.keys(CATEGORY) as Category[]).map((k) => (
            <button key={k} type="button" onClick={() => setCat(k)} className={`border px-4 py-2 text-[0.66rem] tracking-[0.2em] uppercase ${cat === k ? "border-brass text-brass" : "border-line text-stone hover:text-ivory"}`}>
              {k === "watch" ? "⌚ " : k === "jewelry" ? "💍 " : ""}{tr(CATEGORY[k])}
            </button>
          ))}
        </div>
        {cat === "watch" && <WarrantyScan />}
        {cat === "jewelry" && (
          <div className="grid gap-4 sm:grid-cols-4">
            <label>
              <span className={label}>{tr("Tipo de joya *")}</span>
              <select name="j_type" defaultValue={j?.type ?? "ring"} className={field}>
                {Object.entries(JEWELRY_TYPE).map(([k, l]) => <option key={k} value={k}>{tr(l)}</option>)}
              </select>
            </label>
            <label>
              <span className={label}>{tr("Metal")}</span>
              <input name="j_metal" list="metals" defaultValue={j?.metal ?? ""} placeholder={tr("Oro 18k")} className={field} />
              <datalist id="metals">{METALS.map((m) => <option key={m} value={m} />)}</datalist>
            </label>
            <label>
              <span className={label}>{tr("Color del oro")}</span>
              <input name="j_color" list="gold-colors" defaultValue={j?.color ?? ""} placeholder={tr("Amarillo")} className={field} />
              <datalist id="gold-colors">{GOLD_COLORS.map((m) => <option key={m} value={m} />)}</datalist>
            </label>
            <label><span className={label}>{tr("Peso (g)")}</span><input name="j_weight" inputMode="decimal" defaultValue={j?.weight ?? ""} className={field} /></label>
            <label><span className={label}>{tr("Piedra")}</span><input name="j_stone" defaultValue={j?.stone ?? ""} placeholder={tr("Diamante, esmeralda…")} className={field} /></label>
            <label><span className={label}>{tr("Quilates (ct)")}</span><input name="j_carats" inputMode="decimal" defaultValue={j?.carats ?? ""} placeholder="1.02" className={field} /></label>
            <label><span className={label}>{tr("Calidad / certificado")}</span><input name="j_quality" defaultValue={j?.quality ?? ""} placeholder="G / VS1 · GIA" className={field} /></label>
            <label><span className={label}>{tr("Talla o largo")}</span><input name="j_size" defaultValue={j?.size ?? ""} placeholder={tr("6 · 20 in")} className={field} /></label>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-3">
          <label><span className={label}>{cat === "watch" ? tr("Marca *") : tr("Marca o diseñador")}</span><input name="brand" defaultValue={v("brand")} required={cat === "watch"} placeholder={cat === "jewelry" ? tr("Vacío: el tipo de joya") : undefined} className={field} /></label>
          <label><span className={label}>{cat === "watch" ? tr("Modelo") : tr("Nombre")}</span><input name="model" defaultValue={v("model")} placeholder={cat === "jewelry" ? tr("Vacío: metal, piedra y talla") : undefined} className={field} /></label>
          {cat === "watch" && <label><span className={label}>{tr("Ref #")}</span><input name="reference" defaultValue={v("reference")} className={field} /></label>}
          <div><label htmlFor="serial" className={label}>{cat === "watch" ? tr("Serial #") : tr("N.º de serie o certificado (opcional)")}</label><SerialInput id="serial" name="serial" defaultValue={v("serial")} itemId={item?.id} className={field} /></div>
          {cat === "watch" && hasPapers && <label><span className={label}>{tr("Fecha de papeles (opcional)")}</span><input name="papers_date" type="date" defaultValue={v("papers_date")} className={field} /></label>}
          {cat === "watch" && <label><span className={label}>{tr("Eslabones (Links #)")}</span><input name="links" defaultValue={v("links")} placeholder={tr("Full links, +2…")} className={field} /></label>}
          <label>
            <span className={label}>{tr("Condición")}</span>
            <input name="condition" list="conditions" defaultValue={v("condition")} className={field} />
            <datalist id="conditions">{CONDITIONS.map((c) => <option key={c} value={c} />)}</datalist>
          </label>
          <label className="sm:col-span-2"><span className={label}>{tr("Incluye (Comes with)")}</span><input name="comes_with" value={comesWith} onChange={(e) => setComesWith(e.target.value)} placeholder={cat === "watch" ? tr("Caja, papeles, etiquetas…") : tr("Estuche, certificado…")} className={field} /></label>
        </div>
        <label><span className={label}>{tr("Descripción")}</span><textarea name="description" rows={2} defaultValue={v("description")} className={field} /></label>
      </div>

      <div className="grid gap-4">
        <p className={section}>{tr("Entrada")}</p>
        <div className="grid gap-4 sm:grid-cols-3">
          <label>
            <span className={label}>{tr("Cómo entró")}</span>
            <select name="acquisition" value={acq} onChange={(e) => setAcq(e.target.value as Item["acquisition"])} className={field}>
              {Object.entries(ACQUISITION).map(([k, l]) => <option key={k} value={k}>{tr(l)}</option>)}
            </select>
          </label>
          <label><span className={label}>{tr("Fecha de entrada")}</span><input name="purchase_date" type="date" defaultValue={v("purchase_date")} className={field} /></label>
          {acq === "memo" && <label><span className={label}>{tr("Devolver antes de")}</span><input name="memo_due" type="date" defaultValue={v("memo_due")} className={field} /></label>}
          {(acq === "purchase" || acq === "trade") && (
            <label className="flex items-center gap-2 self-end pb-2.5 text-sm text-stone">
              <input type="hidden" name="secondhand_field" value="1" />
              <input type="checkbox" name="secondhand" checked={secondhand} onChange={(e) => setShOverride(e.target.checked)} className="h-4 w-4" />
              {tr("Compra de segunda mano a un particular (retención antes de vender)")}
            </label>
          )}
          {!item && (acq === "purchase" || acq === "trade") && secondhand && <div className="sm:col-span-3"><SellerIdentity /></div>}
          {showCosts && (
            <>
              <label><span className={label}>{owner ? tr("Dueño / dealer (contacto)") : tr("Proveedor (contacto)")}</span><input name="supplier_name" defaultValue={v("supplier_name")} className={field} /></label>
              <label><span className={label}>{tr("Empresa")}</span><input name="supplier_company" defaultValue={v("supplier_company")} onChange={(e) => setCompany(e.target.value)} className={field} /></label>
              <label><span className={label}>{tr("Ubicación")}</span><input name="supplier_location" defaultValue={v("supplier_location")} placeholder={tr("Miami, FL")} className={field} /></label>
              <label><span className={label}>{owner ? tr("A pagar al dueño al vender (USD)") : tr("Costo (USD)")}</span><input name="cost" inputMode="decimal" defaultValue={v("cost")} className={field} /></label>
              <label><span className={label}>{tr("Gastos extra (USD)")}</span><input name="extra_costs" inputMode="decimal" defaultValue={item?.extra_costs ?? ""} placeholder={tr("Servicio, pulido, envío…")} className={field} /></label>
            </>
          )}
          <label><span className={label}>{tr("Precio de venta previsto (USD)")}</span><input name="asking_price" inputMode="decimal" defaultValue={v("asking_price")} className={field} /></label>
          <label><span className={label}>{tr("Precio para dealers (USD)")}</span><input name="dealer_price" inputMode="decimal" defaultValue={v("dealer_price")} placeholder={tr("Vacío: el de venta con el descuento de dealer")} className={field} /></label>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className={cat === "watch" ? "" : "hidden"}>
          <span className={label}>{tr("Ficha en la web")}</span>
          <select name="watch_id" defaultValue={v("watch_id")} className={field}>
            <option value="">{tr("— Sin publicar —")}</option>
            {watches.map((w) => <option key={w.id} value={w.id}>{tr(w.label)}</option>)}
          </select>
        </label>
        <label><span className={label}>{tr("Notas internas")}</span><input name="notes" defaultValue={v("notes")} className={field} /></label>
        {!item && (
          <div className="grid gap-2 sm:col-span-2 sm:grid-cols-[1fr_160px]">
            <label><span className={label}>{tr("⏰ Recordatorio (opcional)")}</span><input name="body" placeholder={tr("Qué falta (ej. que el vendedor entregue la caja)")} className={field} /></label>
            <label><span className={label}>{tr("Para el día")}</span><input name="date" type="date" className={field} /></label>
          </div>
        )}
      </div>

      <div className="flex items-center gap-4">
        <button disabled={pending} className={button}>{pending ? tr("Guardando…") : item ? tr("Guardar cambios") : tr("Añadir al inventario")}</button>
        {state?.error && <p className="text-sm text-red-200/90">{state.error}</p>}
        {state && "ok" in state && !pending && <p className="text-sm text-emerald-200/90">{tr("Guardado")}</p>}
      </div>
    </form>
  );
}

type CustomerOption = { id: string; label: string };

// Venta: un solo pago. El comprador puede ser un cliente del CRM o uno nuevo.
export function SaleForm({ item, customers, today, sellers = [], me, taxRate = 0, openInvoice }: { item: Item; customers: CustomerOption[]; today: string; sellers?: { email: string; label: string }[]; me?: string; taxRate?: number; openInvoice?: { id: string; number: string; total: number } | null }) {
  const tr = useTr();
  const [state, action, pending] = useActionState(sellItem.bind(null, item.id), null);
  const [buyer, setBuyer] = useState("");
  return (
    <form action={action} className="grid gap-4">
      {openInvoice && (
        <p className="border border-amber-300/40 bg-amber-300/5 p-3 text-sm">
          {tr("Este reloj ya tiene la factura")} <a href={`/admin/documentos/${openInvoice.id}`} className="underline">{openInvoice.number}</a> {tr("abierta por $")}{Number(openInvoice.total).toLocaleString("en-US")}{tr(": al registrar la venta se marca")} <b>{tr("pagada esa factura")}</b> {tr("(con su precio y su comprador).")}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <label><span className={label}>{tr("Precio de venta (USD, sin impuesto) *")}</span><input name="sale_price" inputMode="decimal" defaultValue={item.asking_price ?? ""} required className={field} /></label>
        <label><span className={label}>{tr("Fecha")}</span><input name="sale_date" type="date" defaultValue={today} className={field} /></label>
        <label>
          <span className={label}>{tr("Forma de pago")}</span>
          <select name="payment_method" className={field} defaultValue="wire">
            {Object.entries(PAYMENT).map(([k, l]) => <option key={k} value={l}>{tr(l)}</option>)}
          </select>
        </label>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <label>
          <span className={label}>{tr("Impuesto de ventas %")}</span>
          <input name="tax_rate" inputMode="decimal" defaultValue={taxRate} className={field} />
          <span className="mt-1 block text-[0.7rem] text-stone/80">{tr("0 si el comprador es dealer con certificado de reventa o se envía fuera de Florida.")}</span>
        </label>
        <label>
          <span className={label}>{tr("Idioma de la factura")}</span>
          <select name="lang" defaultValue="en" className={field}>
            <option value="en">{tr("Inglés")}</option>
            <option value="es">{tr("Español")}</option>
          </select>
        </label>
      </div>
      {sellers.length > 1 && (
        <label>
          <span className={label}>{tr("Vendido por (comisión)")}</span>
          <select name="sold_by" defaultValue={me} className={field}>
            {sellers.map((s) => <option key={s.email} value={s.email}>{tr(s.label)}</option>)}
          </select>
        </label>
      )}
      <label>
        <span className={label}>{tr("Comprador")}</span>
        <select name="buyer_customer_id" value={buyer} onChange={(e) => setBuyer(e.target.value)} className={field}>
          <option value="">{tr("— Cliente nuevo —")}</option>
          {customers.map((c) => <option key={c.id} value={c.id}>{tr(c.label)}</option>)}
        </select>
      </label>
      {!buyer && (
        <div className="grid gap-4 sm:grid-cols-2">
          <label><span className={label}>{tr("Nombre")}</span><input name="buyer_name" className={field} /></label>
          <label><span className={label}>{tr("Teléfono")}</span><input name="buyer_phone" className={field} /></label>
          <label><span className={label}>{tr("Correo")}</span><input name="buyer_email" type="email" className={field} /></label>
          <label>
            <span className={label}>{tr("¿Cómo nos conoció?")}</span>
            <select name="buyer_source" defaultValue="walk_in" className={field}>
              {Object.entries(SOURCE_LABEL).map(([k, l]) => <option key={k} value={k}>{tr(l)}</option>)}
            </select>
          </label>
        </div>
      )}
      <details className="border border-line/70 p-4">
        <summary className="cursor-pointer text-[0.66rem] tracking-[0.2em] uppercase text-stone">{tr("El cliente entrega un reloj a cambio (opcional)")}</summary>
        <p className="mt-3 text-xs text-stone">{tr("Entrará solo al inventario como «Intercambio», con este valor como costo.")}</p>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          <label><span className={label}>{tr("Marca")}</span><input name="trade_brand" className={field} /></label>
          <label><span className={label}>{tr("Modelo")}</span><input name="trade_model" className={field} /></label>
          <label><span className={label}>{tr("Ref #")}</span><input name="trade_reference" className={field} /></label>
          <div><label htmlFor="trade_serial" className={label}>{tr("Serial #")}</label><SerialInput id="trade_serial" name="trade_serial" className={field} /></div>
          <label><span className={label}>{tr("Valor reconocido (USD)")}</span><input name="trade_value" inputMode="decimal" className={field} /></label>
          <label><span className={label}>{tr("Incluye")}</span><input name="trade_comes_with" placeholder={tr("Caja, papeles…")} className={field} /></label>
        </div>
      </details>
      <div className="flex items-center gap-4">
        <button disabled={pending} className={button}>{pending ? tr("Guardando…") : tr("Registrar venta y factura")}</button>
        {state?.error && <p className="text-sm text-red-200/90">{state.error}</p>}
        {!state?.error && <p className="text-xs text-stone">{tr("Se crea la factura")} <b>pagada</b> {tr("en Documentos, lista para descargar.")}</p>}
      </div>
    </form>
  );
}

export function ReturnForm({ item, today }: { item: Item; today: string }) {
  const tr = useTr();
  const [, action, pending] = useActionState(returnItem.bind(null, item.id), null);
  const to = item.acquisition === "consignment" ? "al consignatario" : item.acquisition === "memo" ? "al dealer" : "";
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-[160px_1fr_auto] sm:items-end">
      <label><span className={label}>{tr("Fecha")}</span><input name="return_date" type="date" defaultValue={today} className={field} /></label>
      <label><span className={label}>{tr("Motivo")}</span><input name="return_reason" placeholder={tr("Sin vender, el dueño lo retira…")} className={field} /></label>
      <button disabled={pending} className="border border-line px-4 py-2.5 text-[0.66rem] tracking-[0.2em] uppercase text-stone hover:border-ivory/40 hover:text-ivory disabled:opacity-60">
        {pending ? tr("Guardando…") : `Devolver ${to}`.trim()}
      </button>
    </form>
  );
}
