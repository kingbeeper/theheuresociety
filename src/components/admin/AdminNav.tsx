"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Section } from "@/lib/crm-perms";

// Menú del CRM: cada usuario ve solo las secciones para las que tiene permiso
const ITEMS: { href: string; label: string; section?: Section }[] = [
  { href: "/admin", label: "Panel" },
  { href: "/admin/leads", label: "Leads", section: "leads" },
  { href: "/admin/citas", label: "Citas", section: "citas" },
  { href: "/admin/inventario", label: "Inventario", section: "inventario" },
  { href: "/admin/demanda", label: "Demanda", section: "demanda" },
  { href: "/admin/documentos", label: "Documentos", section: "documentos" },
  { href: "/admin/informes", label: "Informes", section: "informes" },
  { href: "/admin/compras", label: "Compras y consignas", section: "compras" },
  { href: "/admin/correos", label: "Correos", section: "correos" },
  { href: "/admin/redes", label: "Redes", section: "redes" },
  { href: "/admin/usuarios", label: "Usuarios", section: "usuarios" },
];

export function AdminNav({ allowed }: { allowed: Section[] }) {
  const path = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:px-3 md:pb-0">
      {ITEMS.filter((i) => !i.section || allowed.includes(i.section)).map((i) => {
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
