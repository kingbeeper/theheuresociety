"use client";

import { useState } from "react";
import { GOLD_COLORS, JEWELRY_TYPE, METALS, jewelrySummary, type Jewelry, type JewelryType } from "@/lib/stock-labels";
import { useTr } from "@/components/admin/AdminLang";

const field = "w-full border border-line bg-ink/60 px-2 py-2 text-sm text-ivory outline-none focus:border-brass/70";
const label = "mb-1.5 block text-[0.62rem] tracking-[0.22em] uppercase text-stone";

// Encargo de una joya (p. ej. anillo de compromiso): los datos componen la descripción del encargo
export function JewelrySourcing({ onChange }: { onChange: (title: string, details: string) => void }) {
  const tr = useTr();
  const [j, setJ] = useState<Jewelry>({ type: "engagement", metal: "Oro 18k", color: "Blanco", stone: "Diamante", carats: null, quality: null, size: null, weight: null });
  const set = (patch: Partial<Jewelry>) => {
    const next = { ...j, ...patch };
    setJ(next);
    const metal = [next.metal, next.color?.toLowerCase()].filter(Boolean).join(" ");
    onChange(
      [JEWELRY_TYPE[next.type], metal].filter(Boolean).join(" · "),
      jewelrySummary({ ...next, metal: null, color: null }) // piedra, quilates, calidad y talla
    );
  };
  return (
    <div className="grid gap-3 border border-brass/30 p-3 sm:grid-cols-4">
      <label>
        <span className={label}>{tr("Tipo de joya")}</span>
        <select value={j.type} onChange={(e) => set({ type: e.target.value as JewelryType })} className={field}>
          {Object.entries(JEWELRY_TYPE).map(([k, l]) => <option key={k} value={k}>{tr(l)}</option>)}
        </select>
      </label>
      <label>
        <span className={label}>{tr("Metal")}</span>
        <input list="src-metals" value={j.metal ?? ""} onChange={(e) => set({ metal: e.target.value || null })} className={field} />
        <datalist id="src-metals">{METALS.map((m) => <option key={m} value={m} />)}</datalist>
      </label>
      <label>
        <span className={label}>{tr("Color del oro")}</span>
        <input list="src-colors" value={j.color ?? ""} onChange={(e) => set({ color: e.target.value || null })} className={field} />
        <datalist id="src-colors">{GOLD_COLORS.map((m) => <option key={m} value={m} />)}</datalist>
      </label>
      <label><span className={label}>{tr("Talla o largo")}</span><input value={j.size ?? ""} onChange={(e) => set({ size: e.target.value || null })} placeholder="6" className={field} /></label>
      <label><span className={label}>{tr("Piedra")}</span><input value={j.stone ?? ""} onChange={(e) => set({ stone: e.target.value || null })} className={field} /></label>
      <label><span className={label}>{tr("Quilates (ct)")}</span><input value={j.carats ?? ""} onChange={(e) => set({ carats: e.target.value || null })} placeholder="1.50" inputMode="decimal" className={field} /></label>
      <label className="sm:col-span-2"><span className={label}>{tr("Calidad / certificado / forma")}</span><input value={j.quality ?? ""} onChange={(e) => set({ quality: e.target.value || null })} placeholder={tr("G / VS1 · GIA · talla oval")} className={field} /></label>
    </div>
  );
}
