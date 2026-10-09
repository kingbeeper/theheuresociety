import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

// Pagos con tarjeta con Stripe Checkout (sin SDK: dos llamadas a su API y la firma del webhook).
// Se activa con STRIPE_SECRET_KEY y STRIPE_WEBHOOK_SECRET en el entorno.

export const stripeConfigured = () => Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET);

type CheckoutInput = {
  amount: number; // USD
  name: string;
  description?: string;
  email?: string | null;
  metadata: Record<string, string>;
  successUrl: string;
  cancelUrl: string;
};

export async function createCheckout(i: CheckoutInput) {
  const p = new URLSearchParams({
    mode: "payment",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(Math.round(i.amount * 100)),
    "line_items[0][price_data][product_data][name]": i.name.slice(0, 250),
    success_url: i.successUrl,
    cancel_url: i.cancelUrl,
  });
  if (i.description) p.set("line_items[0][price_data][product_data][description]", i.description.slice(0, 500));
  if (i.email) p.set("customer_email", i.email);
  for (const [k, v] of Object.entries(i.metadata)) p.set(`metadata[${k}]`, v);
  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: p,
  });
  const json = (await res.json()) as { id?: string; url?: string; error?: { message: string } };
  if (!res.ok || !json.id || !json.url) throw new Error(`Stripe: ${json.error?.message ?? res.status}`);
  return { id: json.id, url: json.url };
}

// Cabecera Stripe-Signature: «t=…,v1=…»; firma HMAC-SHA256 de «t.payload» (tolerancia de 5 minutos)
export function validStripeSignature(payload: string, header: string | null) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !header) return false;
  const parts = Object.fromEntries(header.split(",").map((kv) => kv.split("=") as [string, string]));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  const sigs = header.split(",").filter((kv) => kv.startsWith("v1=")).map((kv) => kv.slice(3));
  return sigs.some((s) => s.length === expected.length && timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}
