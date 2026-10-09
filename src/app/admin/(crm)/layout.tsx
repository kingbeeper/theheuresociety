import { Suspense } from "react";
import Link from "next/link";
import { CircleUser, LogOut } from "lucide-react";
import { requireUser } from "@/lib/admin-auth";
import { ALL_SECTIONS, can, ROLE_LABEL } from "@/lib/crm-perms";
import { AdminNav } from "@/components/admin/AdminNav";
import { signOut } from "../actions";

// Todo lo que hay dentro exige sesión de un usuario autorizado
export default function CrmLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <Guard>{children}</Guard>
    </Suspense>
  );
}

async function Guard({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const allowed = ALL_SECTIONS.filter((s) => can(user, s));
  return (
    <div className="min-h-screen md:grid md:grid-cols-[230px_1fr]">
      <aside className="border-b border-line bg-forest md:sticky md:top-0 md:h-screen md:border-b-0 md:border-r">
        <div className="flex items-center justify-between px-5 py-5 md:block md:px-6 md:py-8">
          <div>
            <p className="font-display text-xl tracking-[0.12em] uppercase">The Heure</p>
            <p className="text-[0.62rem] tracking-[0.3em] uppercase text-brass">Society · CRM</p>
          </div>
          <div className="flex items-center gap-4 md:hidden">
            <Link href="/admin/cuenta" aria-label="Mi cuenta" className="flex items-center gap-1.5 text-[0.66rem] tracking-[0.2em] uppercase text-stone hover:text-ivory">
              <CircleUser aria-hidden className="h-4 w-4 text-brass" strokeWidth={1.5} /> Cuenta
            </Link>
            <form action={signOut}>
              <button className="flex items-center gap-1.5 text-[0.66rem] tracking-[0.2em] uppercase text-stone hover:text-ivory">
                <LogOut aria-hidden className="h-3.5 w-3.5" strokeWidth={1.5} /> Salir
              </button>
            </form>
          </div>
        </div>
        <AdminNav allowed={allowed} />
        <div className="hidden px-6 py-8 md:absolute md:bottom-0 md:block">
          <Link href="/admin/cuenta" className="flex items-center gap-2 truncate text-xs text-stone hover:text-ivory">
            <CircleUser aria-hidden className="h-4 w-4 shrink-0 text-brass" strokeWidth={1.5} />
            <span className="truncate">{user.name ?? user.email}</span>
          </Link>
          <p className="pl-6 text-[0.6rem] tracking-[0.16em] uppercase text-stone/70">{ROLE_LABEL[user.role]}</p>
          <form action={signOut} className="mt-2">
            <button className="flex items-center gap-2 text-[0.66rem] tracking-[0.2em] uppercase text-stone hover:text-ivory">
              <LogOut aria-hidden className="h-3.5 w-3.5" strokeWidth={1.5} /> Cerrar sesión
            </button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 px-5 py-8 md:px-10 md:py-10">{children}</main>
    </div>
  );
}
