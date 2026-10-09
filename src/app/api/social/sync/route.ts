import { adminEmail } from "@/lib/admin-auth";
import { syncSocial } from "@/lib/social-sync";

// Actualiza las métricas de Instagram y Facebook.
// - Vercel Cron la llama cada día (cabecera Authorization: Bearer CRON_SECRET)
// - El botón «Actualizar» del CRM la llama con la sesión del usuario
export const maxDuration = 300;

async function run() {
  const result = await syncSocial();
  return Response.json(result, { status: result.ok ? 200 : 400 });
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });
  return run();
}

export async function POST() {
  if (!(await adminEmail("redes"))) return new Response("Unauthorized", { status: 401 });
  return run();
}
