import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createServerClient } from "@supabase/ssr";

// Acceso al CRM: sesión de Supabase Auth (correo y contraseña) y lista de correos autorizados
// (CRM_ADMIN_EMAILS, separados por comas). Los datos se leen después con la clave del servidor.

export async function authClient() {
  const store = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        // En un componente de servidor no se pueden escribir cookies: lo hace el proxy
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {}
      },
    },
  });
}

const allowed = () =>
  (process.env.CRM_ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);

export const isAllowed = (email?: string | null) => Boolean(email && allowed().includes(email.toLowerCase()));

// Usuario del CRM o redirección al inicio de sesión
export async function requireAdmin() {
  const { data } = await (await authClient()).auth.getUser();
  const email = data.user?.email ?? null;
  if (!isAllowed(email)) redirect("/admin/login");
  return email!;
}
