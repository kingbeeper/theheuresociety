"use client";

import Link from "next/link";
import { useState } from "react";
import { useTr } from "@/components/admin/AdminLang";

type Line = { title: string; details: string | null; serial: string | null; category: "watch" | "jewelry" | "other"; qty: number; price: number };
type Inv = { number: string | null; date: string | null; client_name: string | null; client_phone: string | null; client_email: string | null; client_address: string | null; lang: "en" | "es"; items: Line[]; discount: number; tax_rate: number; shipping: number; total: number | null; payment_method: string | null; notes: string | null };
type Row = { key: string; file: string; inv: Inv; state: "ready" | "saving" | "done" | "error"; msg?: string; docId?: string };

const field = "w-full border border-line bg-ink/60 px-2 py-1.5 text-sm text-ivory outline-none focus:border-brass/70";
const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Importar facturas antiguas: se suben (PDF, foto o Excel), se revisan y se guardan una a una o todas
export function ImportInvoices() {
  const tr = useTr();
  const [rows, setRows] = useState<Row[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [reading, setReading] = useState(false);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setReading(true);
    setErrors([]);
    const body = new FormData();
    for (const f of [...files]) body.append("files", f);
    try {
      const res = await fetch("/api/import/invoices", { method: "POST", body });
      const j = (await res.json()) as { results?: { file: string; invoices?: Inv[]; error?: string }[]; error?: string };
      if (j.error) setErrors([j.error]);
      const next: Row[] = [];
      for (const r of j.results ?? []) {
        if (r.error) setErrors((e) => [...e, `${r.file}: ${r.error}`]);
        for (const inv of r.invoices ?? []) next.push({ key: `${r.file}-${next.length}-${Math.random()}`, file: r.file, inv, state: "ready" });
      }
      setRows((rs) => [...rs, ...next]);
    } catch {
      setErrors([tr("No se pudieron leer los archivos.")]);
    }
    setReading(false);
  }

  const update = (key: string, patch: Partial<Inv>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, inv: { ...r.inv, ...patch } } : r)));
  const updateLine = (key: string, i: number, patch: Partial<Line>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, inv: { ...r.inv, items: r.inv.items.map((l, j) => (j === i ? { ...l, ...patch } : l)) } } : r)));

  async function save(row: Row) {
    setRows((rs) => rs.map((r) => (r.key === row.key ? { ...r, state: "saving" } : r)));
    const res = await fetch("/api/import/invoices/save", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ invoice: row.inv, file: row.file }) });
    const j = (await res.json().catch(() => ({ error: "Error" }))) as { ok?: boolean; error?: string; id?: string; number?: string; mismatch?: number | null };
    setRows((rs) =>
      rs.map((r) =>
        r.key === row.key
          ? j.ok
            ? { ...r, state: "done", docId: j.id, msg: j.mismatch != null ? tr("Importada. Ojo: el total leído era {t}; revisa los importes.", { t: usd(j.mismatch) }) : tr("Importada.") }
            : { ...r, state: "error", msg: j.error ?? tr("No se pudo importar.") }
          : r
      )
    );
  }

  const subtotal = (inv: Inv) => inv.items.reduce((a, l) => a + (l.qty || 1) * (l.price || 0), 0);
  const total = (inv: Inv) => {
    const s = subtotal(inv) - (inv.discount || 0);
    return s + s * ((inv.tax_rate || 0) / 100) + (inv.shipping || 0);
  };

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <label className={`cursor-pointer bg-ivory px-5 py-2.5 text-[0.68rem] tracking-[0.22em] uppercase text-ink hover:bg-brass ${reading ? "pointer-events-none opacity-60" : ""}`}>
          {reading ? tr("Leyendo las facturas… (≈20 s cada una)") : tr("📄 Subir facturas (PDF, fotos o Excel)")}
          <input type="file" multiple accept="application/pdf,image/*,.xlsx" className="hidden" onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
        </label>
        <a href="/api/import/invoices/template" download className="border border-line px-4 py-2.5 text-[0.66rem] tracking-[0.2em] uppercase text-stone hover:text-ivory">{tr("⬇ Plantilla de Excel")}</a>
        {rows.some((r) => r.state === "ready") && (
          <button type="button" onClick={() => rows.filter((r) => r.state === "ready").forEach(save)} className="border border-emerald-300/40 px-4 py-2.5 text-[0.66rem] tracking-[0.2em] uppercase text-emerald-200 hover:bg-emerald-300/10">
            {tr("Importar todas ({n})", { n: rows.filter((r) => r.state === "ready").length })}
          </button>
        )}
      </div>
      {errors.length > 0 && <ul className="text-sm text-amber-200">{errors.map((e) => <li key={e}>⚠️ {e}</li>)}</ul>}

      {rows.map((r) => (
        <div key={r.key} className={`grid gap-3 border p-4 ${r.state === "done" ? "border-emerald-300/40" : r.state === "error" ? "border-red-300/40" : "border-line"}`}>
          <p className="flex flex-wrap justify-between gap-2 text-xs text-stone">
            <span>📎 {r.file}</span>
            {r.msg && <span className={r.state === "done" ? "text-emerald-200" : "text-red-200"}>{r.msg} {r.docId && <Link href={`/admin/documentos/${r.docId}`} className="underline">{tr("Ver factura →")}</Link>}</span>}
          </p>
          <fieldset disabled={r.state === "done" || r.state === "saving"} className="grid gap-3">
            <div className="grid gap-2 sm:grid-cols-6">
              <label className="text-xs text-stone">{tr("N.º factura")}<input value={r.inv.number ?? ""} onChange={(e) => update(r.key, { number: e.target.value })} className={field} /></label>
              <label className="text-xs text-stone">{tr("Fecha")}<input type="date" value={r.inv.date ?? ""} onChange={(e) => update(r.key, { date: e.target.value })} className={field} /></label>
              <label className="text-xs text-stone sm:col-span-2">{tr("Cliente")}<input value={r.inv.client_name ?? ""} onChange={(e) => update(r.key, { client_name: e.target.value })} className={field} /></label>
              <label className="text-xs text-stone">{tr("Teléfono")}<input value={r.inv.client_phone ?? ""} onChange={(e) => update(r.key, { client_phone: e.target.value })} className={field} /></label>
              <label className="text-xs text-stone">{tr("Correo")}<input value={r.inv.client_email ?? ""} onChange={(e) => update(r.key, { client_email: e.target.value })} className={field} /></label>
            </div>
            {r.inv.items.map((l, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-[1.4fr_1.2fr_0.8fr_0.7fr_60px_110px]">
                <input value={l.title} onChange={(e) => updateLine(r.key, i, { title: e.target.value })} placeholder={tr("Pieza")} className={field} />
                <input value={l.details ?? ""} onChange={(e) => updateLine(r.key, i, { details: e.target.value })} placeholder={tr("Detalles")} className={field} />
                <input value={l.serial ?? ""} onChange={(e) => updateLine(r.key, i, { serial: e.target.value })} placeholder={tr("Serial")} className={field} />
                <select value={l.category} onChange={(e) => updateLine(r.key, i, { category: e.target.value as Line["category"] })} className={field}>
                  <option value="watch">{tr("Reloj")}</option>
                  <option value="jewelry">{tr("Joya")}</option>
                  <option value="other">{tr("Otro")}</option>
                </select>
                <input value={l.qty} onChange={(e) => updateLine(r.key, i, { qty: Number(e.target.value) || 1 })} inputMode="numeric" className={field} />
                <input value={l.price} onChange={(e) => updateLine(r.key, i, { price: Number(e.target.value.replace(/[^\d.]/g, "")) || 0 })} inputMode="decimal" className={field} />
              </div>
            ))}
            <div className="flex flex-wrap items-end gap-3 text-sm">
              <label className="text-xs text-stone">{tr("Impuesto %")}<input value={r.inv.tax_rate} onChange={(e) => update(r.key, { tax_rate: Number(e.target.value) || 0 })} inputMode="decimal" className={`${field} w-20`} /></label>
              <label className="text-xs text-stone">{tr("Forma de pago")}<input value={r.inv.payment_method ?? ""} onChange={(e) => update(r.key, { payment_method: e.target.value })} className={`${field} w-32`} /></label>
              <label className="text-xs text-stone">{tr("Idioma")}
                <select value={r.inv.lang} onChange={(e) => update(r.key, { lang: e.target.value as "en" | "es" })} className={`${field} w-20`}><option value="en">EN</option><option value="es">ES</option></select>
              </label>
              <span className="ml-auto text-right">
                {tr("Total")}: <b>{usd(total(r.inv))}</b>
                {r.inv.total != null && Math.abs(r.inv.total - total(r.inv)) > 1 && <span className="block text-xs text-amber-200">{tr("En la factura: {t}", { t: usd(r.inv.total) })}</span>}
              </span>
              {r.state !== "done" && (
                <button type="button" onClick={() => save(r)} disabled={r.state === "saving"} className="bg-ivory px-4 py-2 text-[0.66rem] tracking-[0.2em] uppercase text-ink hover:bg-brass disabled:opacity-60">
                  {r.state === "saving" ? tr("Importando…") : tr("Importar")}
                </button>
              )}
            </div>
          </fieldset>
        </div>
      ))}
    </div>
  );
}
