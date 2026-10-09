import { adminDb } from "@/lib/supabase";
import { stripeConfigured } from "@/lib/stripe";
import { invoiceLink } from "@/lib/payments";
import type { Doc } from "@/lib/doc-labels";

// «Pagar con tarjeta» desde el enlace de una factura: crea el pago y lleva a Stripe
export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("t") ?? "";
  if (!stripeConfigured() || !/^[\w-]{20,40}$/.test(token)) return new Response("No disponible", { status: 404 });
  const { data } = await adminDb().from("documents").select("*").eq("token", token).maybeSingle();
  const d = data as Doc | null;
  if (!d || d.kind !== "invoice" || d.status !== "sent") return Response.redirect(new URL(`/d/${token}`, url), 302);
  return Response.redirect(await invoiceLink(d), 303);
}
