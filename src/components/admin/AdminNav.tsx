"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/admin", label: "Panel" },
  { href: "/admin/leads", label: "Leads" },
  { href: "/admin/citas", label: "Citas" },
  { href: "/admin/inventario", label: "Inventario" },
  { href: "/admin/demanda", label: "Demanda" },
  { href: "/admin/documentos", label: "Documentos" },
  { href: "/admin/compras", label: "Compras y consignas" },
  { href: "/admin/redes", label: "Redes" },
];

export function AdminNav() {
  const path = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:px-3 md:pb-0">
      {ITEMS.map((i) => {
        const on = i.href === "/admin" ? path === "/admin" : path.startsWith(i.href);
        return (
          <Link
            key={i.href}
            href={i.href}
            className={`whitespace-nowrap px-3 py-2.5 text-[0.7rem] tracking-[0.2em] uppercase transition-colors ${
              on ? "bg-moss text-ivory" : "text-stone hover:text-ivory"
            }`}
          >
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
