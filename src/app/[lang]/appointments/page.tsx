import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { hasLocale } from "@/lib/i18n";
import { getWatches } from "@/lib/inventory";
import { getDictionary } from "../dictionaries";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { BookingForm } from "@/components/BookingForm";

export async function generateMetadata({ params }: PageProps<"/[lang]/appointments">): Promise<Metadata> {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  const dict = await getDictionary(lang);
  return {
    title: `${dict.booking.title} — The Heure Society`,
    description: dict.booking.lead,
    alternates: { languages: { en: "/en/appointments", es: "/es/appointments" } },
  };
}

export default async function AppointmentsPage({ params }: PageProps<"/[lang]/appointments">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const dict = await getDictionary(lang);

  // Solo piezas que se pueden ver (no vendidas)
  const pieces = (await getWatches())
    .filter((w) => w.status !== "sold")
    .map((w) => ({ slug: w.slug, brand: w.brand, model: w.model, reference: w.reference, image: w.images[0] }));

  return (
    <>
      <Header lang={lang} dict={dict} />
      <main className="mx-auto max-w-7xl px-5 pb-28 pt-36 md:px-10 md:pt-44">
        <p className="eyebrow">{dict.booking.eyebrow}</p>
        <h1 className="mt-5 font-display text-5xl font-light leading-[1.05] md:text-6xl">{dict.booking.title}</h1>
        <p className="mt-6 max-w-xl leading-relaxed text-stone">{dict.booking.lead}</p>

        <div className="mt-16">
          {/* El formulario lee ?type= y ?watch= de la URL y calcula las fechas en el navegador */}
          <Suspense fallback={<div className="min-h-[60vh]" />}>
            <BookingForm lang={lang} dict={dict} pieces={pieces} />
          </Suspense>
        </div>
      </main>
      <Footer lang={lang} dict={dict} />
    </>
  );
}
