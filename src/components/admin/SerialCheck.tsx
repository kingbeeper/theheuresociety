"use client";


import { useTr } from "@/components/admin/AdminLang";
import Link from "next/link";
import { useEffect, useState } from "react";

// Aviso al escribir un número de serie: si ese reloj ya pasó por el sistema (compra, venta,
// consignación, memo, encargo…), lo dice con su historial.

type Row = { event: string; label: string; event_date: string; party: string | null; watch: string | null; item_id: string | null; sku: string | null; document_id: string | null; doc_number: string | null };

export function SerialWarning({ value, itemId, docId }: { value: string | null | undefined; itemId?: string | null; docId?: string | null }) {
  const tr = useTr();
  const [rows, setRows] = useState<Row[] | null>(null);
  const serial = (value ?? "").replace(/[^a-z0-9]/gi, "");

  useEffect(() => {
    if (serial.length < 4) return;
    const ctrl = new AbortController();
    // Espera a que se termine de escribir
    const t = setTimeout(() => {
      const q = new URLSearchParams({ s: serial, ...(itemId && { item: itemId }), ...(docId && { doc: docId }) });
      fetch(`/api/serial?${q}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : { rows: [] }))
        .then((j: { rows: Row[] }) => setRows(j.rows))
        .catch(() => {});
    }, 500);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [serial, itemId, docId]);

  if (serial.length < 4 || !rows?.length) return null;
  return (
    <div className="mt-2 border border-amber-300/50 bg-amber-300/5 p-3 text-xs">
      <p className="font-semibold text-amber-200">{tr("⚠️ Este reloj ya pasó por el sistema")}</p>
      <ul className="mt-1.5 space-y-1">
        {rows.map((r, i) => (
          <li key={i}>
            <span className="tabular-nums text-stone">{r.event_date}</span> · {tr(r.label)}
            {r.party ? ` · ${r.party}` : ""}
            {r.item_id && r.sku ? <> · <Link href={`/admin/inventario/${r.item_id}`} className="underline hover:text-ivory">{r.sku}</Link></> : null}
            {r.document_id && r.doc_number ? <> · <Link href={`/admin/documentos/${r.document_id}`} className="underline hover:text-ivory">{r.doc_number}</Link></> : null}
            {r.watch ? <span className="block text-stone">{r.watch}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

// Campo de serial con el aviso debajo (formularios sin estado propio)
export function SerialInput({ id, name, defaultValue, itemId, className }: { id: string; name: string; defaultValue?: string | null; itemId?: string | null; className?: string }) {
  const [value, setValue] = useState(defaultValue ?? "");
  return (
    <>
      <input id={id} name={name} value={value} onChange={(e) => setValue(e.target.value)} autoComplete="off" className={className} />
      <SerialWarning value={value} itemId={itemId} />
    </>
  );
}
