import { validStripeSignature } from "@/lib/stripe";
import { paymentCompleted } from "@/lib/payments";

// Webhook de Stripe: pago completado → depósito (reserva) o factura pagada
export async function POST(request: Request) {
  const payload = await request.text();
  if (!validStripeSignature(payload, request.headers.get("stripe-signature"))) return new Response("Bad signature", { status: 400 });
  const event = JSON.parse(payload) as { type: string; data: { object: { payment_status?: string; metadata?: { payment_id?: string } } } };
  const s = event.data.object;
  const done = (event.type === "checkout.session.completed" && s.payment_status === "paid") || event.type === "checkout.session.async_payment_succeeded";
  if (done && s.metadata?.payment_id) await paymentCompleted(s.metadata.payment_id);
  return new Response("ok");
}
