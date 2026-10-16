"use client";

import { createContext, useContext } from "react";
import { translate, type AdminLang } from "@/lib/admin-i18n";

// Idioma del CRM para los componentes de cliente: const tr = useTr(); tr("Guardar")
const Ctx = createContext<AdminLang>("es");

export function AdminLangProvider({ lang, children }: { lang: AdminLang; children: React.ReactNode }) {
  return <Ctx.Provider value={lang}>{children}</Ctx.Provider>;
}

export function useAdminLang() {
  return useContext(Ctx);
}

export function useTr() {
  const lang = useContext(Ctx);
  return (s: string | null | undefined, vars?: Record<string, string | number>) => translate(lang, s, vars);
}
