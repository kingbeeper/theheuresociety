"use client";

import Link from "next/link";

export function PrintLabels() {
  return (
    <div className="flex gap-3">
      <Link href="/admin/inventario" className="border border-[#111] px-4 py-2 text-[0.66rem] tracking-[0.2em] uppercase">← Inventario</Link>
      <button onClick={() => window.print()} className="bg-[#111] px-5 py-2 text-[0.66rem] tracking-[0.2em] uppercase text-white">Imprimir</button>
    </div>
  );
}
