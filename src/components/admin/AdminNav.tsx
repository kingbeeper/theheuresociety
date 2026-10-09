"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AtSign, CalendarDays, ChartColumn, FileText, HandCoins, LayoutDashboard, Mail, TrendingUp, UserCog, Users, Watch, type LucideIcon,
} from "lucide-react";
import type { Section } from "@/lib/crm-perms";

// Menú del CRM: cada usuario ve solo las secciones para las que tiene permiso
const ITEMS: { href: string; label: string; icon: LucideIcon; section?: Section }[] = [
  { href: "/admin", label: "Panel", icon: LayoutDashboard },
  { href: "/admin/leads", label: "Leads", icon: Users, section: "leads" },
  { href: "/admin/citas", label: "Citas", icon: CalendarDays, section: "citas" },
  { href: "/admin/inventario", label: "Inventario", icon: Watch, section: "inventario" },
  { href: "/admin/demanda", label: "Demanda", icon: TrendingUp, section: "demanda" },
  { href: "/admin/documentos", label: "Documentos", icon: FileText, section: "documentos" },
  { href: "/admin/informes", label: "Informes", icon: ChartColumn, section: "informes" },
  { href: "/admin/compras", label: "Compras y consignas", icon: HandCoins, section: "compras" },
  { href: "/admin/correos", label: "Correos", icon: Mail, section: "correos" },
  { href: "/admin/redes", label: "Redes", icon: AtSign, section: "redes" },
  { href: "/admin/usuarios", label: "Usuarios", icon: UserCog, section: "usuarios" },
];

export function AdminNav({ allowed }: { allowed: Section[] }) {
  const path = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:overflow-visible md:px-3 md:pb-0">
      {ITEMS.filter((i) => !i.section || allowed.includes(i.section)).map((i) => {
        const on = i.href === "/admin" ? path === "/admin" : path.startsWith(i.href);
        const Icon = i.icon;
        return (
          <Link
            key={i.href}
            href={i.href}
            className={`group flex items-center gap-2 whitespace-nowrap px-3 py-2.5 md:gap-3 md:whitespace-normal md:leading-snug text-[0.7rem] tracking-[0.2em] uppercase transition-colors ${
              on ? "bg-moss text-ivory" : "text-stone hover:text-ivory"
            }`}
          >
            <Icon aria-hidden className={`h-4 w-4 shrink-0 ${on ? "text-brass" : "text-stone/80 group-hover:text-brass"}`} strokeWidth={1.5} />
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
