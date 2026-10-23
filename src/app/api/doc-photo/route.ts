import { redirect } from "next/navigation";
import { adminDb } from "@/lib/supabase";
import { photoLink } from "@/lib/item-photos";

// Foto de un documento (contrato de compra o consignación): solo con su enlace privado (token)
export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("t") ?? "";
  const i = Number(url.searchParams.get("i"));
  if (!/^[\w-]{16,}$/.test(token) || !Number.isInteger(i) || i < 0) return new Response("Not found", { status: 404 });
  const { data } = await adminDb().from("documents").select("photos").eq("token", token).maybeSingle();
  const p = ((data?.photos ?? []) as string[])[i];
  const link = p ? await photoLink(p) : null;
  if (!link) return new Response("Not found", { status: 404 });
  redirect(link);
}
