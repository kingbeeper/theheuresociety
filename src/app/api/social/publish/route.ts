import { publishDue } from "@/lib/ig-publish";
import { sendDueReminders } from "@/lib/bot-reminders";

// Pasada de cada 10 minutos (Supabase pg_cron, Authorization: Bearer CRON_SECRET): avisa de los
// recordatorios de clientes que ya tocan y publica en Instagram las ideas aprobadas cuya hora llegó.
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });
  const reminders = await sendDueReminders().catch((e) => `error: ${(e as Error).message}`);
  return Response.json({ ok: true, reminders, results: await publishDue() });
}
