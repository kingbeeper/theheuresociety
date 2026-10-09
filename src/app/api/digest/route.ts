import { adminEmail } from "@/lib/admin-auth";
import { sendDigest } from "@/lib/digest";

// Resumen diario por Telegram. Vercel Cron la llama cada mañana (Authorization: Bearer CRON_SECRET);
// desde el CRM se puede enviar a mano para probar.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });
  await sendDigest();
  return new Response("ok");
}

export async function POST() {
  if (!(await adminEmail("informes"))) return new Response("Unauthorized", { status: 401 });
  await sendDigest();
  return Response.json({ ok: true });
}
