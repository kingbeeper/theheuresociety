import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { locales, defaultLocale, type Locale } from "@/lib/i18n";

// Países hispanohablantes: si la IP viene de aquí, se sirve español.
const SPANISH_COUNTRIES = new Set([
  "ES", "MX", "AR", "CO", "CL", "PE", "VE", "EC", "GT", "CU", "BO", "DO",
  "HN", "PY", "SV", "NI", "CR", "PA", "UY", "PR", "GQ",
]);

function detectLocale(request: NextRequest): Locale {
  // 1. Elección manual previa del visitante
  const saved = request.cookies.get("locale")?.value;
  if (saved && locales.includes(saved as Locale)) return saved as Locale;

  // 2. País (cabecera que añade Vercel en producción)
  const country = request.headers.get("x-vercel-ip-country");
  if (country) return SPANISH_COUNTRIES.has(country) ? "es" : "en";

  // 3. Idioma del navegador
  const accept = request.headers.get("accept-language") ?? "";
  const first = accept.split(",")[0]?.trim().slice(0, 2).toLowerCase();
  return first === "es" ? "es" : defaultLocale;
}

// CRM (/admin): renueva la sesión de Supabase en cada visita (las páginas no pueden escribir cookies)
async function refreshAdminSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  await supabase.auth.getUser();
  return response;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return refreshAdminSession(request);
  if (pathname.startsWith("/d/")) return; // documento compartido con el cliente (sin idioma en la URL)
  const hasLocale = locales.some(
    (l) => pathname === `/${l}` || pathname.startsWith(`/${l}/`)
  );
  if (hasLocale) return;

  request.nextUrl.pathname = `/${detectLocale(request)}${pathname}`;
  return NextResponse.redirect(request.nextUrl);
}

export const config = {
  // Ignora internos de Next, la API y archivos estáticos (con extensión)
  matcher: ["/((?!_next|api|.*\\..*).*)"],
};
