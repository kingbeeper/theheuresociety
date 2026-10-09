import { Suspense } from "react";
import { requireAdmin } from "@/lib/admin-auth";
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
  const email = await requireAdmin();
  return (
    <div className="min-h-screen md:grid md:grid-cols-[230px_1fr]">
      <aside className="border-b border-line bg-forest md:sticky md:top-0 md:h-screen md:border-b-0 md:border-r">
        <div className="flex items-center justify-between px-5 py-5 md:block md:px-6 md:py-8">
          <div>
            <p className="font-display text-xl tracking-[0.12em] uppercase">The Heure</p>
            <p className="text-[0.62rem] tracking-[0.3em] uppercase text-brass">Society · CRM</p>
          </div>
          <form action={signOut} className="md:hidden">
            <button className="text-[0.66rem] tracking-[0.2em] uppercase text-stone hover:text-ivory">Salir</button>
          </form>
        </div>
        <AdminNav />
        <div className="hidden px-6 py-8 md:absolute md:bottom-0 md:block">
          <p className="truncate text-xs text-stone">{email}</p>
          <form action={signOut} className="mt-2">
            <button className="text-[0.66rem] tracking-[0.2em] uppercase text-stone hover:text-ivory">Cerrar sesión</button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 px-5 py-8 md:px-10 md:py-10">{children}</main>
    </div>
  );
}
