import { NextResponse } from "next/server";
import { authClient, isAllowed } from "@/lib/admin-auth";

// Enlace de invitación o de recuperación: abre la sesión y lleva a «Mi cuenta» para poner la contraseña
export async function GET(request: Request) {
  const url = new URL(request.url);
  const token_hash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") === "recovery" ? "recovery" : "invite";
  const fail = NextResponse.redirect(new URL("/admin/login/enlace-caducado", url));
  if (!token_hash) return fail;
  const supabase = await authClient();
  const { data, error } = await supabase.auth.verifyOtp({ token_hash, type });
  if (error || !(await isAllowed(data.user?.email))) return fail;
  return NextResponse.redirect(new URL("/admin/cuenta?bienvenida=1", url));
}
