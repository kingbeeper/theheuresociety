"use client";

import { useActionState, useState } from "react";
import { convertSourcing, markDepositReceived, markPaid, saveDocument } from "@/app/admin/document-actions";
import { ID_TYPES, KIND_LABEL, depositPct, docTotals, suggestedDeposit, usd, type Doc, type DocKind, type DocLine } from "@/lib/doc-labels";
import { PAYMENT } from "@/lib/stock-labels";

const field =
  "w-full border border-line bg-ink/60 px-3 py-2.5 text-sm text-ivory placeholder:text-stone/50 outline-none transition-colors focus:border-brass/70";
const small = "w-full border border-line bg-ink/60 px-2 py-2 text-sm text-ivory outline-none focus:border-brass/70";
const label = "mb-1.5 block text-[0.62rem] tracking-[0.22em] uppercase text-stone";
const section = "text-[0.66rem] tracking-[0.24em] uppercase text-brass";

export type CustomerOption = { id: string; label: string; name: string | null; email: string | null; phone: string | null };
export type StockOption = { id: string; sku: string; title: string; details: string; serial: string | null; price: number | null; cost?: number | null };

const addDays = (iso: string, n: number) => new Date(new Date(`${iso}T12:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
const DUE_DAYS: Record<DocKind, number> = { quote: 7, memo: 14, invoice: 0, consignment: 90, purchase: 0, sourcing: 60 };
const noTax = (k: DocKind) => k === "memo" || k === "consignment" || k === "purchase" || k === "sourcing";

export function DocumentForm({
  doc, kind: initialKind, customers, stock, terms, taxRate, today, presetCustomer, presetItem,
}: {
  doc?: Doc;
  kind: DocKind;
  customers: CustomerOption[];
  stock: StockOption[];
  terms: Record<DocKind, string>;
  taxRate: number;
  today: string;
  presetCustomer?: string;
  presetItem?: string;
}) {
  const [state, action, pending] = useActionState(saveDocument.bind(null, doc?.id ?? null), null);
  const [kind, setKind] = useState<DocKind>(doc?.kind ?? initialKind);
  const preset = customers.find((c) => c.id === (doc?.customer_id ?? presetCustomer));
  const [customer, setCustomer] = useState(preset?.id ?? "");
  const [client, setClient] = useState({
    client_name: doc?.client_name ?? preset?.name ?? "",
    client_email: doc?.client_email ?? preset?.email ?? "",
    client_phone: doc?.client_phone ?? preset?.phone ?? "",
  });
  // En consignación, el importe de la línea es el neto al dueño (el «costo» del inventario)
  const fromStock = (s: StockOption, k: DocKind = kind): DocLine => ({ item_id: s.id, sku: s.sku, title: s.title, details: s.details, serial: s.serial, qty: 1, price: (k === "consignment" || k === "purchase" ? s.cost : s.price) ?? 0 });
  const presetLine = stock.find((s) => s.id === presetItem);
  const blank: DocLine = { title: "", qty: 1, price: 0 };
  const [lines, setLines] = useState<DocLine[]>(doc?.items ?? (presetLine ? [fromStock(presetLine, initialKind)] : initialKind === "sourcing" ? [blank] : []));
  // Encargo: anticipo sugerido según el precio (se puede cambiar)
  const [deposit, setDeposit] = useState(doc?.deposit ? String(doc.deposit) : "");
  const [discount, setDiscount] = useState(String(doc?.discount ?? 0));
  const [tax, setTax] = useState(String(doc?.tax_rate ?? (noTax(initialKind) ? 0 : taxRate)));
  const [shipping, setShipping] = useState(String(doc?.shipping ?? 0));
  const [termsText, setTermsText] = useState(doc?.terms ?? terms[initialKind]);
  const [due, setDue] = useState(doc?.due_date ?? addDays(today, DUE_DAYS[initialKind]));

  const totals = docTotals({ items: lines, discount: Number(discount), tax_rate: Number(tax), shipping: Number(shipping) });
  const update = (i: number, patch: Partial<DocLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const used = new Set(lines.map((l) => l.item_id));

  const pickCustomer = (id: string) => {
    setCustomer(id);
    const c = customers.find((x) => x.id === id);
    setClient({ client_name: c?.name ?? "", client_email: c?.email ?? "", client_phone: c?.phone ?? "" });
  };
  const changeKind = (k: DocKind) => {
    setKind(k);
    setTermsText(terms[k]);
    setDue(addDays(today, DUE_DAYS[k]));
    setTax(String(noTax(k) ? 0 : taxRate));
    if (k === "sourcing" && !lines.length) setLines([blank]);
  };
  const sourcing = kind === "sourcing";
  const suggested = suggestedDeposit(totals.total);

  return (
    <form action={action} className="grid gap-7">
      <input type="hidden" name="items" value={JSON.stringify(lines)} />

      <div className="grid gap-4 sm:grid-cols-4">
        <label>
          <span className={label}>Tipo</span>
          <select name="kind" value={kind} onChange={(e) => changeKind(e.target.value as DocKind)} disabled={Boolean(doc)} className={field}>
            {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          {doc && <input type="hidden" name="kind" value={kind} />}
        </label>
        <label><span className={label}>Fecha</span><input name="issue_date" type="date" defaultValue={doc?.issue_date ?? today} className={field} /></label>
        {kind !== "purchase" ? (
          <label>
            <span className={label}>{kind === "quote" ? "Válida hasta" : kind === "memo" ? "Devolver antes de" : kind === "consignment" ? "Vigente hasta" : sourcing ? "Plazo de búsqueda hasta" : "Vence"}</span>
            <input name="due_date" type="date" value={due} onChange={(e) => setDue(e.target.value)} className={field} />
          </label>
        ) : (
          <div />
        )}
        <label>
          <span className={label}>Idioma del documento</span>
          <select name="lang" defaultValue={doc?.lang ?? "en"} className={field}>
            <option value="en">Inglés</option>
            <option value="es">Español</option>
          </select>
        </label>
      </div>

      <div className="grid gap-4">
        <p className={section}>{kind === "consignment" ? "Consignante (dueño del reloj)" : kind === "purchase" ? "Vendedor" : "Cliente"}</p>
        <label>
          <span className={label}>Cliente del CRM</span>
          <select name="customer_id" value={customer} onChange={(e) => pickCustomer(e.target.value)} className={field}>
            <option value="">— Cliente nuevo (se crea en el CRM) —</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
        <div className="grid gap-4 sm:grid-cols-3">
          <label><span className={label}>Nombre *</span><input name="client_name" value={client.client_name} onChange={(e) => setClient({ ...client, client_name: e.target.value })} required className={field} /></label>
          <label><span className={label}>Empresa</span><input name="client_company" defaultValue={doc?.client_company ?? ""} className={field} /></label>
          <label><span className={label}>Teléfono</span><input name="client_phone" value={client.client_phone} onChange={(e) => setClient({ ...client, client_phone: e.target.value })} className={field} /></label>
          <label><span className={label}>Correo</span><input name="client_email" type="email" value={client.client_email} onChange={(e) => setClient({ ...client, client_email: e.target.value })} className={field} /></label>
          <label className="sm:col-span-2"><span className={label}>Dirección</span><input name="client_address" defaultValue={doc?.client_address ?? ""} placeholder="Calle, ciudad, estado, código postal" className={field} /></label>
        </div>
      </div>

      <div className="grid gap-3">
        <p className={section}>{sourcing ? "Reloj que busca el cliente" : "Relojes y conceptos"}</p>
        {sourcing && <p className="text-xs text-stone">Describe el reloj (marca, modelo y referencia) y en el detalle la esfera, el año mínimo, si tiene que traer caja y papeles y el estado. El precio es el <b>máximo acordado</b> con el cliente.</p>}
        {kind === "purchase" && (
          <div className="grid gap-4 sm:grid-cols-3">
            <label>
              <span className={label}>Identificación</span>
              <select name="seller_id_type" defaultValue={doc?.seller_id_type ?? "Driver's license"} className={field}>
                {ID_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label><span className={label}>Número</span><input name="seller_id_number" defaultValue={doc?.seller_id_number ?? ""} autoComplete="off" className={field} /></label>
            <label><span className={label}>Fecha de nacimiento</span><input name="seller_dob" type="date" defaultValue={doc?.seller_dob ?? ""} className={field} /></label>
            <p className="text-xs text-stone sm:col-span-3">El número completo y la fecha de nacimiento quedan solo en el CRM; el documento muestra los 4 últimos caracteres.</p>
          </div>
        )}
        {kind === "purchase" && <p className="text-xs text-stone">El precio de cada línea es lo que <b>pagamos al vendedor</b>.</p>}
        {kind === "consignment" && <p className="text-xs text-stone">El precio de cada línea es el <b>neto al dueño</b>: lo que le pagaremos cuando se venda.</p>}
        {lines.map((l, i) => (
          <div key={i} className="grid gap-2 border border-line/70 p-3 sm:grid-cols-[1.4fr_1fr_0.8fr_70px_130px_auto] sm:items-start">
            <div>
              <input value={l.title} onChange={(e) => update(i, { title: e.target.value })} placeholder="Rolex Daytona 126500LN" className={small} />
              {l.sku && <p className="mt-1 text-[0.66rem] text-stone">Inventario {l.sku}</p>}
            </div>
            <input value={l.details ?? ""} onChange={(e) => update(i, { details: e.target.value })} placeholder="Año, caja y papeles…" className={small} />
            <input value={l.serial ?? ""} onChange={(e) => update(i, { serial: e.target.value })} placeholder="Serial" className={small} />
            <input value={l.qty} onChange={(e) => update(i, { qty: Number(e.target.value) || 1 })} inputMode="numeric" aria-label="Cantidad" className={small} />
            <input value={l.price} onChange={(e) => update(i, { price: Number(e.target.value.replace(/[^\d.]/g, "")) || 0 })} inputMode="decimal" aria-label="Precio" className={small} />
            <button type="button" onClick={() => setLines(lines.filter((_, j) => j !== i))} className="px-2 py-2 text-xs text-stone hover:text-red-200" aria-label="Quitar">✕</button>
          </div>
        ))}
        <div className={`flex flex-wrap gap-2 ${sourcing ? "hidden" : ""}`}>
          <select
            value=""
            onChange={(e) => {
              const s = stock.find((x) => x.id === e.target.value);
              if (s) setLines([...lines, fromStock(s)]);
            }}
            className={`${field} w-auto max-w-full`}
          >
            <option value="">+ Añadir reloj del inventario…</option>
            {stock.filter((s) => !used.has(s.id)).map((s) => <option key={s.id} value={s.id}>{s.sku} · {s.title}{s.price ? ` · ${usd(s.price)}` : ""}</option>)}
          </select>
          <button type="button" onClick={() => setLines([...lines, { title: "", qty: 1, price: 0 }])} className="border border-line px-4 py-2 text-[0.66rem] tracking-[0.18em] uppercase text-stone hover:text-ivory">
            + Línea libre
          </button>
        </div>
        <label className="flex items-center gap-2 text-sm text-stone">
          <input name="show_serial" type="checkbox" defaultChecked={doc?.show_serial ?? kind !== "quote"} className="h-4 w-4" /> Mostrar el número de serie en el documento
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-[1fr_320px]">
        <div className="grid gap-4">
          <label>
            <span className={label}>Forma de pago</span>
            <select name="payment_method" defaultValue={doc?.payment_method ?? ""} className={field}>
              <option value="">—</option>
              {Object.values(PAYMENT).map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label><span className={label}>Notas (salen en el documento)</span><textarea name="notes" rows={2} defaultValue={doc?.notes ?? ""} className={field} /></label>
          <label><span className={label}>Términos</span><textarea name="terms" rows={4} value={termsText} onChange={(e) => setTermsText(e.target.value)} className={field} /></label>
        </div>
        {sourcing ? (
          <div className="grid content-start gap-3 border border-line/70 p-4 text-sm">
            <input type="hidden" name="discount" value="0" />
            <input type="hidden" name="tax_rate" value="0" />
            <input type="hidden" name="shipping" value="0" />
            <p className="flex justify-between font-display text-xl"><span>Precio hasta</span><span className="tabular-nums">{usd(totals.total)}</span></p>
            <label className="flex items-center justify-between gap-3"><span className="text-stone">Anticipo $</span><input name="deposit" value={deposit} onChange={(e) => setDeposit(e.target.value)} placeholder={String(suggested || "")} inputMode="decimal" className={`${small} w-32 text-right`} /></label>
            {suggested > 0 && (
              <button type="button" onClick={() => setDeposit(String(suggested))} className="text-left text-xs text-brass hover:text-ivory">
                Sugerido: {usd(suggested)} ({depositPct(totals.total)} % del precio) · usar
              </button>
            )}
            <p className="text-[0.7rem] text-stone/80">Hasta $15k: 20 % · hasta $50k: 15 % · hasta $150k: 10 % · más: 8 %. El anticipo se descuenta de la factura al conseguir el reloj y se devuelve íntegro si no se consigue.</p>
          </div>
        ) : (
        <div className="grid content-start gap-3 border border-line/70 p-4 text-sm">
          <p className="flex justify-between"><span className="text-stone">Subtotal</span><span className="tabular-nums">{usd(totals.subtotal)}</span></p>
          <label className="flex items-center justify-between gap-3"><span className="text-stone">Descuento $</span><input name="discount" value={discount} onChange={(e) => setDiscount(e.target.value)} inputMode="decimal" className={`${small} w-28 text-right`} /></label>
          <label className="flex items-center justify-between gap-3"><span className="text-stone">Impuesto %</span><input name="tax_rate" value={tax} onChange={(e) => setTax(e.target.value)} inputMode="decimal" className={`${small} w-28 text-right`} /></label>
          {totals.tax > 0 && <p className="flex justify-between text-xs text-stone"><span>Impuesto</span><span className="tabular-nums">{usd(totals.tax)}</span></p>}
          <label className="flex items-center justify-between gap-3"><span className="text-stone">Envío y seguro $</span><input name="shipping" value={shipping} onChange={(e) => setShipping(e.target.value)} inputMode="decimal" className={`${small} w-28 text-right`} /></label>
          <p className="mt-1 flex justify-between border-t border-line pt-3 font-display text-2xl"><span>Total</span><span className="tabular-nums">{usd(totals.total)}</span></p>
          <p className="text-[0.7rem] text-stone/80">Impuesto 0 si el cliente es dealer con certificado de reventa o el envío es fuera de Florida.</p>
        </div>
        )}
      </div>

      <div className="flex items-center gap-4">
        <button disabled={pending} className="bg-ivory px-5 py-2.5 text-[0.68rem] tracking-[0.22em] uppercase text-ink hover:bg-brass disabled:opacity-60">
          {pending ? "Guardando…" : doc ? "Guardar cambios" : `Crear ${KIND_LABEL[kind].toLowerCase()}`}
        </button>
        {state && "error" in state && <p className="text-sm text-red-200/90">{state.error}</p>}
        {state && "ok" in state && !pending && <p className="text-sm text-emerald-200/90">Guardado</p>}
      </div>
    </form>
  );
}

export function PaidForm({ id, today, method }: { id: string; today: string; method: string | null }) {
  const [state, action, pending] = useActionState(markPaid.bind(null, id), null);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <label><span className={label}>Fecha de pago</span><input name="paid_at" type="date" defaultValue={today} className={field} /></label>
      <label>
        <span className={label}>Forma de pago</span>
        <select name="payment_method" defaultValue={method ?? "Transferencia"} className={field}>
          {Object.values(PAYMENT).map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </label>
      <button disabled={pending} className="bg-ivory px-5 py-2.5 text-[0.68rem] tracking-[0.22em] uppercase text-ink hover:bg-brass disabled:opacity-60">
        {pending ? "Guardando…" : "Marcar pagada"}
      </button>
      {state && "error" in state && <p className="text-sm text-red-200/90">{state.error}</p>}
    </form>
  );
}

// Encargo: anticipo recibido a mano (efectivo, transferencia, Zelle…)
export function DepositForm({ id, today }: { id: string; today: string }) {
  const [state, action, pending] = useActionState(markDepositReceived.bind(null, id), null);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <label><span className={label}>Fecha</span><input name="paid_at" type="date" defaultValue={today} className={field} /></label>
      <label>
        <span className={label}>Forma de pago</span>
        <select name="payment_method" defaultValue="Transferencia" className={field}>
          {Object.values(PAYMENT).map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </label>
      <button disabled={pending} className="bg-ivory px-5 py-2.5 text-[0.68rem] tracking-[0.22em] uppercase text-ink hover:bg-brass disabled:opacity-60">
        {pending ? "Guardando…" : "Anticipo recibido"}
      </button>
      {state && "error" in state && <p className="text-sm text-red-200/90">{state.error}</p>}
    </form>
  );
}

// Encargo conseguido: el reloj (del inventario o el descrito) y el precio final → factura
export function SourcedForm({ id, stock, price }: { id: string; stock: StockOption[]; price: number }) {
  const [state, action, pending] = useActionState(convertSourcing.bind(null, id), null);
  const [final, setFinal] = useState(String(price || ""));
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-[1fr_160px_auto] sm:items-end">
      <label>
        <span className={label}>Reloj conseguido</span>
        <select name="item_id" defaultValue="" onChange={(e) => { const s = stock.find((x) => x.id === e.target.value); if (s?.price) setFinal(String(s.price)); }} className={field}>
          <option value="">— El descrito en el encargo (aún no está en el inventario) —</option>
          {stock.map((s) => <option key={s.id} value={s.id}>{s.sku} · {s.title}{s.price ? ` · ${usd(s.price)}` : ""}</option>)}
        </select>
      </label>
      <label><span className={label}>Precio final $</span><input name="price" value={final} onChange={(e) => setFinal(e.target.value)} inputMode="decimal" className={field} /></label>
      <button disabled={pending} className="bg-ivory px-5 py-2.5 text-[0.68rem] tracking-[0.22em] uppercase text-ink hover:bg-brass disabled:opacity-60">
        {pending ? "Creando…" : "Conseguido: facturar"}
      </button>
      {state && "error" in state && <p className="text-sm text-red-200/90 sm:col-span-3">{state.error}</p>}
    </form>
  );
}
