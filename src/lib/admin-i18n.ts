import { cache } from "react";
import { EN } from "./i18n/admin-en";

// Idioma del CRM (español o inglés), elegido por cada usuario con el selector ES / EN del menú (cookie
// crm_lang). Los textos se escriben en español y se envuelven con tr("…"): en inglés se buscan en el
// diccionario (i18n/admin-en.ts) y, si falta alguno, se queda en español en vez de romperse.
// En el servidor el idioma se guarda por petición al comprobar la sesión (requireUser); en los
// componentes de cliente se usa useTr() (AdminLang.tsx).

export type AdminLang = "es" | "en";
export const LANG_COOKIE = "crm_lang";

const store = cache(() => ({ lang: "es" as AdminLang }));
export const setAdminLang = (lang: AdminLang) => {
  store().lang = lang;
};
export const adminLang = (): AdminLang => store().lang;

export function translate(lang: AdminLang, s: string | null | undefined, vars?: Record<string, string | number>) {
  if (s == null) return "";
  let out = lang === "en" ? EN[s] ?? EN[s.trim()] ?? s : s;
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, String(v));
  return out;
}

// Traducción en componentes de servidor y acciones: tr("Clientes"), tr("Hace {n} días", { n })
export const tr = (s: string | null | undefined, vars?: Record<string, string | number>) => translate(adminLang(), s, vars);

// Títulos compuestos («Mis dealers · 3», «Encargo S-2026-0001 · Juan»): cada parte por separado
export const trParts = (s: string | null | undefined) => (s ?? "").split(" · ").map((p) => tr(p)).join(" · ");

// Formato de fechas según el idioma (es-ES / en-US), siempre en hora de Miami
export const dateLocale = () => (adminLang() === "en" ? "en-US" : "es-ES");
