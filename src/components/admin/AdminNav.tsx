"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AtSign, CalendarDays, CalendarClock, Wallet, Handshake, Receipt, Wrench, ListTodo, ChartColumn, FileText, HandCoins, LayoutDashboard, Mail, Megaphone, TrendingUp, UserCog, UserCheck, Users, Contact, Watch, type LucideIcon,
} from "lucide-react";
import type { Section } from "@/lib/crm-perms";
import { useTr } from "@/components/admin/AdminLang";

type Tab = { href: string; label: string; icon: LucideIcon; section?: Section };
type Item = Tab & { tabs?: Tab[] };

// Menú del CRM: cada usuario ve solo las secciones para las que tiene permiso. Algunas secciones agrupan
// varias páginas (con pestañas arriba); las direcciones de cada página no cambian.
const ITEMS: Item[] = [
  { href: "/admin", label: "Panel", icon: LayoutDashboard },
  {
    href: "/admin/tareas", label: "Agenda", icon: CalendarClock,
    tabs: [
      { href: "/admin/tareas", label: "Tareas", icon: ListTodo },
      { href: "/admin/citas", label: "Citas", icon: CalendarDays, section: "citas" },
    ],
  },
  {
    href: "/admin/clientes", label: "Contactos", icon: Contact,
    tabs: [
      { href: "/admin/clientes", label: "Clientes", icon: UserCheck, section: "leads" },
      { href: "/admin/leads", label: "Leads", icon: Users, section: "leads" },
      { href: "/admin/dealers", label: "Dealers", icon: Handshake, section: "leads" },
    ],
  },
  { href: "/admin/inventario", label: "Inventario", icon: Watch, section: "inventario" },
  { href: "/admin/documentos", label: "Documentos", icon: FileText, section: "documentos" },
  { href: "/admin/servicios", label: "Servicios", icon: Wrench, section: "documentos" },
  { href: "/admin/cobros", label: "Cobros", icon: Receipt, section: "documentos" },
  { href: "/admin/dinero", label: "Dinero", icon: Wallet, section: "costos" },
  { href: "/admin/informes", label: "Informes", icon: ChartColumn, section: "informes" },
  {
    href: "/admin/compras", label: "Redes", icon: Megaphone,
    tabs: [
      { href: "/admin/compras", label: "Ofertas de clientes", icon: HandCoins, section: "compras" },
      { href: "/admin/correos", label: "Correos", icon: Mail, section: "correos" },
      { href: "/admin/demanda", label: "Demanda", icon: TrendingUp, section: "demanda" },
    ],
  },
  { href: "/admin/redes", label: "Instagram", icon: AtSign, section: "redes" },
  { href: "/admin/usuarios", label: "Usuarios", icon: UserCog, section: "usuarios" },
];

const ok = (t: Tab, allowed: Section[]) => !t.section || allowed.includes(t.section);
const under = (path: string, href: string) => path === href || path.startsWith(`${href}/`);

// Lo que ve cada usuario: los grupos solo con sus pestañas permitidas (y enlazan a la primera)
function visible(allowed: Section[]) {
  return ITEMS.flatMap((i) => {
    if (!i.tabs) return ok(i, allowed) ? [i] : [];
    const tabs = i.tabs.filter((t) => ok(t, allowed));
    return tabs.length ? [{ ...i, href: tabs[0].href, tabs }] : [];
  });
}

export function AdminNav({ allowed }: { allowed: Section[] }) {
  const path = usePathname();
  const tr = useTr();
  return (
    <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:overflow-visible md:px-3 md:pb-0">
      {visible(allowed).map((i) => {
        const on = i.href === "/admin" ? path === "/admin" : (i.tabs ?? [i]).some((t) => under(path, t.href));
        const Icon = i.icon;
        return (
          <Link
            key={i.label}
            href={i.href}
            className={`group flex items-center gap-2 whitespace-nowrap px-3 py-2.5 md:gap-3 md:whitespace-normal md:leading-snug text-[0.7rem] tracking-[0.2em] uppercase transition-colors ${
              on ? "bg-moss text-ivory" : "text-stone hover:text-ivory"
            }`}
          >
            <Icon aria-hidden className={`h-4 w-4 shrink-0 ${on ? "text-brass" : "text-stone/80 group-hover:text-brass"}`} strokeWidth={1.5} />
            {tr(i.label)}
          </Link>
        );
      })}
    </nav>
  );
}

// Pestañas de la sección agrupada (Agenda, Contactos, Redes), arriba de su página principal
export function SectionTabs({ allowed }: { allowed: Section[] }) {
  const path = usePathname();
  const tr = useTr();
  const group = visible(allowed).find((i) => i.tabs && i.tabs.length > 1 && i.tabs.some((t) => t.href === path));
  if (!group?.tabs) return null;
  return (
    <div className="mb-6 flex gap-2 overflow-x-auto border-b border-line pb-px">
      {group.tabs.map((t) => {
        const on = t.href === path;
        const Icon = t.icon;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={on ? "page" : undefined}
            className={`-mb-px flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-sm transition-colors ${on ? "border-brass text-ivory" : "border-transparent text-stone hover:text-ivory"}`}
          >
            <Icon aria-hidden className={`h-4 w-4 ${on ? "text-brass" : ""}`} strokeWidth={1.5} />
            {tr(t.label)}
          </Link>
        );
      })}
    </div>
  );
}
