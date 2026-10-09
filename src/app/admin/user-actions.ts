"use server";

import { refresh } from "next/cache";
import { authClient, ownerEmails, requireUser } from "@/lib/admin-auth";
import { adminDb } from "@/lib/supabase";
import { ALL_SECTIONS, PRESETS, type Section } from "@/lib/crm-perms";

// Usuarios del CRM: alta, permisos, baja y enlace de acceso. Solo con el permiso «usuarios».
// La contraseña la pone cada usuario al abrir su enlace (nadie más la conoce).

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://theheuresociety.vercel.app").replace(/\/$/, "");
const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim() || null;

function extras(f: FormData) {
  const rate = Number(String(f.get("commission_rate") ?? "0").replace(",", "."));
  const tg = String(f.get("telegram_id") ?? "").replace(/\D/g, "");
  return {
    commission_rate: Number.isFinite(rate) ? Math.min(100, Math.max(0, rate)) : 0,
    commission_base: f.get("commission_base") === "sale" ? "sale" : "profit",
    telegram_id: tg || null,
  };
}

function permissionsFrom(f: FormData) {
  const preset = PRESETS[String(f.get("preset") ?? "custom")] ?? PRESETS.custom;
  if (preset.role === "admin") return { role: "admin", permissions: ALL_SECTIONS };
  const chosen = f.getAll("perm").map(String).filter((p): p is Section => (ALL_SECTIONS as string[]).includes(p));
  return { role: "staff", permissions: chosen };
}

// Enlace de un solo uso para entrar y poner la contraseña. Usuario nuevo: invitación; si ya existe: recuperación.
async function accessLink(email: string) {
  const auth = adminDb().auth.admin;
  let res = await auth.generateLink({ type: "invite", email });
  let type = "invite";
  if (res.error) {
    res = await auth.generateLink({ type: "recovery", email });
    type = "recovery";
  }
  if (res.error || !res.data.properties?.hashed_token) throw new Error(res.error?.message ?? "No se pudo generar el enlace");
  return `${SITE}/admin/auth/confirm?token_hash=${res.data.properties.hashed_token}&type=${type}`;
}

export async function addUser(_: unknown, f: FormData) {
  const me = await requireUser("usuarios");
  const email = text(f, "email")?.toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Correo no válido." };
  if (ownerEmails().includes(email)) return { error: "Ese correo ya es superadministrador." };
  const { role, permissions } = permissionsFrom(f);
  if (role === "staff" && !permissions.length) return { error: "Elige al menos un permiso." };
  const { error } = await adminDb()
    .from("crm_users")
    .upsert({ email, name: text(f, "name"), role, permissions, ...extras(f), active: true, invited_by: me.email, updated_at: new Date().toISOString() }, { onConflict: "email" });
  if (error) return { error: error.message };
  try {
    const link = await accessLink(email);
    refresh();
    return { ok: true, email, link };
  } catch (e) {
    return { error: `Usuario guardado, pero no se pudo crear el enlace: ${(e as Error).message}` };
  }
}

export async function updateUser(email: string, _: unknown, f: FormData) {
  await requireUser("usuarios");
  const { role, permissions } = permissionsFrom(f);
  const { error } = await adminDb().from("crm_users").update({ name: text(f, "name"), role, permissions, ...extras(f), updated_at: new Date().toISOString() }).eq("email", email);
  if (error) return { error: error.message };
  refresh();
  return { ok: true };
}

export async function setUserActive(email: string, active: boolean) {
  const me = await requireUser("usuarios");
  if (email === me.email) return;
  await adminDb().from("crm_users").update({ active, updated_at: new Date().toISOString() }).eq("email", email);
  refresh();
}

export async function newAccessLink(email: string) {
  await requireUser("usuarios");
  try {
    return { ok: true, email, link: await accessLink(email) };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// Mi cuenta: cambiar la contraseña (también al entrar por primera vez desde la invitación)
export async function changePassword(_: unknown, f: FormData) {
  await requireUser();
  const password = String(f.get("password") ?? "");
  if (password.length < 10) return { error: "Mínimo 10 caracteres." };
  if (password !== String(f.get("confirm") ?? "")) return { error: "Las dos contraseñas no coinciden." };
  const { error } = await (await authClient()).auth.updateUser({ password });
  if (error) return { error: error.message };
  return { ok: true };
}
