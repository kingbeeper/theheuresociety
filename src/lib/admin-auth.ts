import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createServerClient } from "@supabase/ssr";
import { adminDb } from "./supabase";
import { ALL_SECTIONS, can, type CrmUser, type Section } from "./crm-perms";

// Acceso al CRM: sesión de Supabase Auth (correo y contraseña).
// Superadministradores: los correos de CRM_ADMIN_EMAILS (separados por comas), con todos los permisos.
// Los demás usuarios están en la tabla crm_users, con su papel y sus permisos por sección.

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

export const ownerEmails = () =>
  (process.env.CRM_ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);

// Usuario del CRM por su correo (o null si no tiene acceso). Una consulta por petición.
export const crmUser = cache(async (email?: string | null): Promise<CrmUser | null> => {
  const e = email?.trim().toLowerCase();
  if (!e) return null;
  if (ownerEmails().includes(e)) return { email: e, name: null, role: "owner", permissions: ALL_SECTIONS };
  const { data, error } = await adminDb().from("crm_users").select("email, name, role, permissions, active").eq("email", e).maybeSingle();
  if (error || !data?.active) return null;
  return { email: e, name: data.name, role: data.role === "admin" ? "admin" : "staff", permissions: (data.permissions ?? []) as Section[] };
});

export const isAllowed = async (email?: string | null) => Boolean(await crmUser(email));

const sessionUser = cache(async () => {
  const { data } = await (await authClient()).auth.getUser();
  return crmUser(data.user?.email);
});

// Usuario actual con permiso para la sección (o redirección). Sin sección: cualquier usuario del CRM.
export async function requireUser(section?: Section) {
  const user = await sessionUser();
  if (!user) redirect("/admin/login");
  if (section && !can(user, section)) redirect("/admin?sin-permiso=1");
  return user;
}

// Compatibilidad: devuelve el correo (para el historial «hecho por…»)
export async function requireAdmin(section?: Section) {
  return (await requireUser(section)).email;
}

export async function currentUser() {
  return sessionUser();
}

// Para rutas de API: el correo del usuario con permiso, o null
export async function adminEmail(section?: Section) {
  const user = await sessionUser();
  if (!user || (section && !can(user, section))) return null;
  return user.email;
}
