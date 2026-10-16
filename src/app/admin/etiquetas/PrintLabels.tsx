"use client";


import { useTr } from "@/components/admin/AdminLang";
import Link from "next/link";

export function PrintLabels() {
  const tr = useTr();
  return (
    <div className="flex gap-3">
      <Link href="/admin/inventario" className="border border-[#111] px-4 py-2 text-[0.66rem] tracking-[0.2em] uppercase">{tr("← Inventario")}</Link>
      <button onClick={() => window.print()} className="bg-[#111] px-5 py-2 text-[0.66rem] tracking-[0.2em] uppercase text-white">{tr("Imprimir")}</button>
    </div>
  );
}
