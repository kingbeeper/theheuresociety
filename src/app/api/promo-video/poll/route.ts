import { pollPromoVideo, validPollToken } from "@/lib/promo-video";

// Espera el video de Higgsfield y, cuando está, le pone el texto y lo envía por Telegram
export const maxDuration = 300;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/.test(id) || !validPollToken(id, url.searchParams.get("k") ?? "")) return new Response("Unauthorized", { status: 401 });
  await pollPromoVideo(id, 240_000, Number(url.searchParams.get("hop") ?? 0));
  return new Response("ok");
}
