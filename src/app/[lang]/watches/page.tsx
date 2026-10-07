import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasLocale } from "@/lib/i18n";
import { brands, watches } from "@/lib/watches";
import { getDictionary } from "../dictionaries";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Catalog } from "@/components/Catalog";

export async function generateMetadata({ params }: PageProps<"/[lang]/watches">): Promise<Metadata> {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  const dict = await getDictionary(lang);
  return {
    title: `${dict.nav.collection} — The Heure Society`,
    description: dict.catalog.lead,
    alternates: { languages: { en: "/en/watches", es: "/es/watches" } },
  };
}

export default async function WatchesPage({ params }: PageProps<"/[lang]/watches">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const dict = await getDictionary(lang);

  return (
    <>
      <Header lang={lang} dict={dict} />
      <main className="mx-auto max-w-7xl px-5 pb-28 pt-36 md:px-10 md:pt-44">
        <p className="eyebrow">{dict.catalog.eyebrow}</p>
        <h1 className="mt-5 max-w-3xl font-display text-5xl font-light leading-[1.05] md:text-6xl">
          {dict.catalog.title}
        </h1>
        <p className="mt-6 max-w-lg leading-relaxed text-stone">{dict.catalog.lead}</p>

        <div className="mt-14">
          <Catalog watches={watches} brands={brands} lang={lang} dict={dict} />
        </div>
      </main>
      <Footer lang={lang} dict={dict} />
    </>
  );
}
