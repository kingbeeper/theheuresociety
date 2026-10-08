import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasLocale, type Locale } from "@/lib/i18n";
import { pageMetadata } from "@/lib/seo";
import { contact } from "@/lib/site";
import { getDictionary } from "../dictionaries";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

// Política de privacidad (la exige Meta para el chatbot de WhatsApp). Incluye cómo pedir que se
// borren los datos, en la sección #delete, que es la URL de «eliminación de datos» de la app de Meta.

const UPDATED = "2026-10-09";
const phone = contact.phoneDisplay;
const address = `${contact.address.street}, ${contact.address.city}, ${contact.address.region} ${contact.address.postalCode}`;

const COPY: Record<Locale, { title: string; lead: string; sections: { id?: string; h: string; p: string[] }[]; updated: string }> = {
  es: {
    title: "Política de privacidad",
    lead: "Cómo tratamos los datos que nos facilita en esta web y en nuestro WhatsApp.",
    updated: "Última actualización",
    sections: [
      { h: "Quiénes somos", p: [`The Heure Society, con oficina en ${address}. Teléfono y WhatsApp: ${phone}.`] },
      {
        h: "Qué datos recogemos",
        p: [
          "Los que usted nos envía: nombre, teléfono, correo electrónico, los mensajes y fotos que comparte por WhatsApp o en nuestros formularios, y los datos de los relojes que desea comprar, vender o consignar.",
          "No pedimos ni guardamos datos de tarjetas, cuentas bancarias ni documentos de identidad por estos medios.",
        ],
      },
      {
        h: "Para qué los usamos",
        p: [
          "Para responder a sus consultas, organizar citas en nuestra oficina o por videollamada, preparar ofertas por su reloj y gestionar consignaciones. No vendemos sus datos ni los usamos para publicidad de terceros.",
          "Nuestro WhatsApp cuenta con un asistente automático basado en inteligencia artificial que responde consultas sobre la colección y las citas; una persona del equipo atiende la conversación siempre que usted lo pida.",
        ],
      },
      {
        h: "Con quién los compartimos",
        p: [
          "Solo con los proveedores que necesitamos para prestar el servicio, que los tratan en nuestro nombre: Meta (WhatsApp), Supabase (base de datos), Vercel (alojamiento web), Anthropic (asistente de IA) y Telegram (avisos internos al equipo).",
        ],
      },
      { h: "Cuánto tiempo los guardamos", p: ["Mientras mantengamos una relación con usted y, después, solo el tiempo que exijan nuestras obligaciones legales."] },
      {
        id: "delete",
        h: "Sus derechos y cómo borrar sus datos",
        p: [
          `Puede pedirnos en cualquier momento acceder a sus datos, corregirlos o eliminarlos, incluido el historial de sus conversaciones de WhatsApp. Escríbanos por WhatsApp o llame al ${phone} indicando «Eliminar mis datos», o visítenos en ${address}. Lo haremos en un plazo máximo de 30 días y se lo confirmaremos.`,
        ],
      },
    ],
  },
  en: {
    title: "Privacy policy",
    lead: "How we handle the information you share on this website and on our WhatsApp.",
    updated: "Last updated",
    sections: [
      { h: "Who we are", p: [`The Heure Society, with offices at ${address}. Phone and WhatsApp: ${phone}.`] },
      {
        h: "What we collect",
        p: [
          "What you send us: your name, phone, email, the messages and photos you share on WhatsApp or through our forms, and details of the watches you wish to buy, sell or consign.",
          "We never ask for or store card details, bank accounts or identity documents through these channels.",
        ],
      },
      {
        h: "How we use it",
        p: [
          "To answer your enquiries, arrange appointments at our office or by video call, prepare offers for your watch and manage consignments. We do not sell your data or use it for third-party advertising.",
          "Our WhatsApp includes an automated AI assistant that answers questions about the collection and appointments; a member of our team takes over whenever you ask.",
        ],
      },
      {
        h: "Who we share it with",
        p: [
          "Only the providers we need to deliver the service, who process it on our behalf: Meta (WhatsApp), Supabase (database), Vercel (web hosting), Anthropic (AI assistant) and Telegram (internal team notifications).",
        ],
      },
      { h: "How long we keep it", p: ["For as long as we have a relationship with you and, afterwards, only as long as our legal obligations require."] },
      {
        id: "delete",
        h: "Your rights and how to delete your data",
        p: [
          `You can ask us at any time to access, correct or delete your data, including your WhatsApp conversation history. Message us on WhatsApp or call ${phone} saying "Delete my data", or visit us at ${address}. We will do so within 30 days and confirm it to you.`,
        ],
      },
    ],
  },
};

export async function generateMetadata({ params }: PageProps<"/[lang]/privacy">): Promise<Metadata> {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  return pageMetadata(lang, "/privacy", { title: `${COPY[lang].title} — The Heure Society`, description: COPY[lang].lead });
}

export default async function PrivacyPage({ params }: PageProps<"/[lang]/privacy">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const dict = await getDictionary(lang);
  const t = COPY[lang];

  return (
    <>
      <Header lang={lang} dict={dict} />
      <main className="mx-auto max-w-3xl px-5 pb-28 pt-36 md:px-10 md:pt-44">
        <p className="eyebrow">The Heure Society</p>
        <h1 className="mt-5 font-display text-5xl font-light leading-none md:text-6xl">{t.title}</h1>
        <p className="mt-6 text-lg leading-relaxed text-stone">{t.lead}</p>
        <p className="mt-3 text-xs tracking-[0.18em] uppercase text-stone/70">
          {t.updated}: {UPDATED}
        </p>
        <div className="mt-14 space-y-12">
          {t.sections.map((s) => (
            <section key={s.h} id={s.id} className="scroll-mt-32">
              <h2 className="font-display text-2xl">{s.h}</h2>
              {s.p.map((p) => (
                <p key={p.slice(0, 24)} className="mt-4 leading-relaxed text-stone">
                  {p}
                </p>
              ))}
            </section>
          ))}
        </div>
      </main>
      <Footer lang={lang} dict={dict} />
    </>
  );
}
