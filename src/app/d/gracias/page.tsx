import { Suspense } from "react";

// Vuelta de Stripe tras un depósito
export default function ThanksPage({ searchParams }: PageProps<"/d/gracias">) {
  return (
    <Suspense fallback={<main className="min-h-screen" />}>
      <Thanks searchParams={searchParams} />
    </Suspense>
  );
}

async function Thanks({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const cancelled = Boolean((await searchParams).cancelado);
  return (
    <main className="grid min-h-screen place-items-center px-6 text-center">
      <div>
        <p className="font-display text-2xl tracking-[0.18em] uppercase">The Heure Society</p>
        <p className="mt-6 font-display text-3xl">{cancelled ? "Payment cancelled · Pago cancelado" : "Thank you · Gracias"}</p>
        <p className="mt-3 text-sm text-[#5d625e]">
          {cancelled
            ? "No charge was made. · No se realizó ningún cargo."
            : "We received your deposit and the piece is reserved for you. · Recibimos su depósito y la pieza queda reservada para usted."}
        </p>
      </div>
    </main>
  );
}
