import { redirect } from "next/navigation";
import { adminDb } from "@/lib/supabase";
import { privateUrl } from "@/lib/private-files";

// Foto de una ficha de inspección o de una orden de servicio: solo con el enlace privado del documento (token); enlace de 1 minuto
export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("t") ?? "";
  const i = Number(url.searchParams.get("i"));
  if (!/^[\w-]{16,}$/.test(token) || !Number.isInteger(i) || i < 0) return new Response("Not found", { status: 404 });
  const { data } = await adminDb().from("documents").select("inspection, service").eq("token", token).in("kind", ["inspection", "service"]).maybeSingle();
  const path = ((data?.inspection ?? data?.service) as { photos?: string[] } | null)?.photos?.[i];
  const link = path ? await privateUrl(path, 60) : null;
  if (!link) return new Response("Not found", { status: 404 });
  redirect(link);
}
