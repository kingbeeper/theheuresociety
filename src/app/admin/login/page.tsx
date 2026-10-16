import { Suspense } from "react";
import { cookies } from "next/headers";
import { LANG_COOKIE, setAdminLang } from "@/lib/admin-i18n";
import { AdminLangProvider } from "@/components/admin/AdminLang";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Acceso" };

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(ellipse_70%_60%_at_50%_45%,var(--color-emerald)_0%,var(--color-ink)_75%)] px-5">
      <div className="w-full max-w-sm text-center">
        <p className="eyebrow">The Heure Society</p>
        <h1 className="mt-4 font-display text-4xl font-light">CRM</h1>
        <Suspense fallback={<div className="mt-10 h-48" />}>
          <Form />
        </Suspense>
      </div>
    </main>
  );
}

// El formulario en el idioma que el usuario eligió la última vez (ES / EN)
async function Form() {
  const lang = (await cookies()).get(LANG_COOKIE)?.value === "en" ? "en" : "es";
  setAdminLang(lang);
  return (
    <AdminLangProvider lang={lang}>
      <LoginForm />
    </AdminLangProvider>
  );
}
