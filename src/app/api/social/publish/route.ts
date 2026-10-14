import { publishDue } from "@/lib/ig-publish";

// Publica en Instagram las ideas aprobadas cuya hora ya llegó. La llama Supabase (pg_cron) cada
// 10 minutos con Authorization: Bearer CRON_SECRET.
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });
  return Response.json({ ok: true, results: await publishDue() });
}
