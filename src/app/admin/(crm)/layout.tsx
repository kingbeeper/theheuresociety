import { Suspense } from "react";
import Link from "next/link";
import { CircleUser, LogOut } from "lucide-react";
import { requireUser } from "@/lib/admin-auth";
import { ALL_SECTIONS, can, ROLE_LABEL } from "@/lib/crm-perms";
import { AdminNav } from "@/components/admin/AdminNav";
import { GlobalSearch } from "@/components/admin/GlobalSearch";
import { setLangAction, signOut } from "../actions";
import { adminLang, tr } from "@/lib/admin-i18n";
import { AdminLangProvider } from "@/components/admin/AdminLang";

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
  const lang = adminLang();
  const langSwitch = (
    <div className="flex items-center gap-1 text-[0.62rem] tracking-[0.2em]">
      {(["es", "en"] as const).map((l) => (
        <form key={l} action={setLangAction.bind(null, l)}>
          <button aria-pressed={lang === l} className={`border px-2 py-0.5 ${lang === l ? "border-brass text-brass" : "border-line text-stone hover:text-ivory"}`}>{l.toUpperCase()}</button>
        </form>
      ))}
    </div>
  );
  return (
    <AdminLangProvider lang={lang}>
    <div className="min-h-screen md:grid md:grid-cols-[230px_1fr]">
      <aside className="border-b border-line bg-forest md:sticky md:top-0 md:h-screen md:border-b-0 md:border-r">
        <div className="flex items-center justify-between px-5 py-5 md:block md:px-6 md:py-8">
          <div>
            <p className="font-display text-xl tracking-[0.12em] uppercase">The Heure</p>
            <p className="text-[0.62rem] tracking-[0.3em] uppercase text-brass">Society · CRM</p>
          </div>
          <div className="flex items-center gap-4 md:hidden">
            {langSwitch}
            <Link href="/admin/cuenta" aria-label={tr("Mi cuenta")} className="flex items-center gap-1.5 text-[0.66rem] tracking-[0.2em] uppercase text-stone hover:text-ivory">
              <CircleUser aria-hidden className="h-4 w-4 text-brass" strokeWidth={1.5} /> {tr("Cuenta")}
            </Link>
            <form action={signOut}>
              <button className="flex items-center gap-1.5 text-[0.66rem] tracking-[0.2em] uppercase text-stone hover:text-ivory">
                <LogOut aria-hidden className="h-3.5 w-3.5" strokeWidth={1.5} /> {tr("Salir")}
              </button>
            </form>
          </div>
        </div>
        <GlobalSearch />
        <AdminNav allowed={allowed} />
        <div className="hidden px-6 py-8 md:absolute md:bottom-0 md:block">
          <Link href="/admin/cuenta" className="flex items-center gap-2 truncate text-xs text-stone hover:text-ivory">
            <CircleUser aria-hidden className="h-4 w-4 shrink-0 text-brass" strokeWidth={1.5} />
            <span className="truncate">{user.name ?? user.email}</span>
          </Link>
          <p className="pl-6 text-[0.6rem] tracking-[0.16em] uppercase text-stone/70">{tr(ROLE_LABEL[user.role])}</p>
          <div className="mt-3 pl-6">{langSwitch}</div>
          <form action={signOut} className="mt-2">
            <button className="flex items-center gap-2 text-[0.66rem] tracking-[0.2em] uppercase text-stone hover:text-ivory">
              <LogOut aria-hidden className="h-3.5 w-3.5" strokeWidth={1.5} /> {tr("Cerrar sesión")}
            </button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 px-5 py-8 md:px-10 md:py-10">{children}</main>
    </div>
    </AdminLangProvider>
  );
}
