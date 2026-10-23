"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Plus, X } from "lucide-react";
import type { Section } from "@/lib/crm-perms";
import { useTr } from "@/components/admin/AdminLang";

const OPTIONS: { href: string; label: string; emoji: string; section?: Section }[] = [
  { href: "/admin/leads?nuevo=1", label: "Cliente o lead", emoji: "👤", section: "leads" },
  { href: "/admin/tareas?nueva=1", label: "Tarea", emoji: "✅" },
  { href: "/admin/documentos/nuevo?tipo=proforma", label: "Proforma", emoji: "🧾", section: "documentos" },
  { href: "/admin/documentos/nuevo?tipo=invoice", label: "Factura", emoji: "💵", section: "documentos" },
  { href: "/admin/documentos/nuevo?tipo=quote", label: "Cotización", emoji: "📄", section: "documentos" },
  { href: "/admin/inventario/nuevo", label: "Pieza al inventario", emoji: "⌚", section: "inventario" },
  { href: "/admin/compras?nueva=1", label: "Oferta de un cliente", emoji: "🤲", section: "compras" },
];

// Botón «+» en todas las pantallas del CRM: crear lo que sea sin buscar en qué menú está
export function QuickCreate({ allowed }: { allowed: Section[] }) {
  const tr = useTr();
  const path = usePathname();
  // Se cierra solo al cambiar de página
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === path;
  const setOpen = (v: boolean) => setOpenAt(v ? path : null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpenAt(null);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpenAt(null);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open, path]);

  return (
    <div ref={box} className="fixed bottom-5 right-5 z-40 flex flex-col items-end gap-3 print:hidden">
      {open && (
        <ul role="menu" className="w-60 border border-line bg-forest py-2 shadow-2xl">
          {OPTIONS.filter((o) => !o.section || allowed.includes(o.section)).map((o) => (
            <li key={o.href} role="none">
              <Link role="menuitem" href={o.href} className="flex items-center gap-3 px-4 py-2.5 text-sm text-ivory hover:bg-moss">
                <span aria-hidden>{o.emoji}</span>
                {tr(o.label)}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={open ? tr("Cerrar") : tr("Crear nuevo")}
        className="flex h-14 w-14 items-center justify-center rounded-full bg-brass text-ink shadow-xl transition-transform hover:scale-105"
      >
        {open ? <X aria-hidden className="h-6 w-6" strokeWidth={2} /> : <Plus aria-hidden className="h-6 w-6" strokeWidth={2} />}
      </button>
    </div>
  );
}
