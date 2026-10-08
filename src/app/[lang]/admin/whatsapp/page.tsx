import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { WhatsAppConnect } from "@/components/WhatsAppConnect";

// Página privada para conectar el WhatsApp Business de la tienda al chatbot (una sola vez).
// Se abre con /es/admin/whatsapp?key=WHATSAPP_ONBOARD_KEY
export const metadata: Metadata = { title: "Conectar WhatsApp — The Heure Society", robots: { index: false, follow: false } };

export default function Page({ searchParams }: PageProps<"/[lang]/admin/whatsapp">) {
  return (
    <Suspense fallback={null}>
      <Gate searchParams={searchParams} />
    </Suspense>
  );
}

async function Gate({ searchParams }: { searchParams: PageProps<"/[lang]/admin/whatsapp">["searchParams"] }) {
  const { key } = await searchParams;
  const expected = process.env.WHATSAPP_ONBOARD_KEY;
  if (!expected || key !== expected) notFound();

  const appId = process.env.NEXT_PUBLIC_META_APP_ID;
  const configId = process.env.NEXT_PUBLIC_META_ES_CONFIG_ID;
  return (
    <main className="mx-auto max-w-xl px-5 py-24">
      <p className="eyebrow">The Heure Society · Admin</p>
      <h1 className="mt-4 font-display text-4xl font-light">Conectar WhatsApp</h1>
      <p className="mt-6 leading-relaxed text-stone">
        Conecta el número de WhatsApp Business de la tienda al chatbot. Seguirás usando la app en tu teléfono:
        cuando escribas tú en un chat, el bot se aparta.
      </p>
      <ol className="mt-6 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-stone">
        <li>Ten a mano el teléfono con la app WhatsApp Business abierta (versión 2.24.17 o superior).</li>
        <li>Pulsa el botón e inicia sesión con la cuenta de Facebook que administra el negocio.</li>
        <li>Elige «Conectar tu cuenta de WhatsApp Business existente» y escanea el código QR desde la app.</li>
        <li>Acepta compartir el historial de chats y espera a que esta página confirme la conexión.</li>
      </ol>
      {appId && configId ? (
        <WhatsAppConnect appId={appId} configId={configId} onboardKey={key} />
      ) : (
        <p className="mt-10 border-l border-brass/60 pl-4 text-sm text-stone">
          Faltan NEXT_PUBLIC_META_APP_ID y NEXT_PUBLIC_META_ES_CONFIG_ID en la configuración.
        </p>
      )}
    </main>
  );
}
