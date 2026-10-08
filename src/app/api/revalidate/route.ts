import { revalidateTag } from "next/cache";
import { INVENTORY_TAG } from "@/lib/inventory";

// Actualiza el inventario de la web. Lo usa el robot cuando termina un trabajo en segundo
// plano (p. ej. el recorte del estuche), donde revalidateTag no tiene efecto.
export async function POST(request: Request) {
  if (!process.env.TELEGRAM_WEBHOOK_SECRET || request.headers.get("x-revalidate-secret") !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }
  revalidateTag(INVENTORY_TAG, { expire: 0 });
  return new Response("ok");
}
