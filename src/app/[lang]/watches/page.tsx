import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasLocale } from "@/lib/i18n";
import { breadcrumbJsonLd, JsonLd, pageMetadata } from "@/lib/seo";
import { getBrands, getWatches } from "@/lib/inventory";
import { getDictionary } from "../dictionaries";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Catalog } from "@/components/Catalog";
import { GoldMonogram } from "@/components/GoldMonogram";
import { CollectionTitle } from "@/components/CollectionTitle";

export async function generateMetadata({ params }: PageProps<"/[lang]/watches">): Promise<Metadata> {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  const dict = await getDictionary(lang);
  return pageMetadata(lang, "/watches", {
    title: `${dict.nav.collection} — The Heure Society`,
    description: dict.catalog.lead,
  });
}

export default async function WatchesPage({ params }: PageProps<"/[lang]/watches">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const dict = await getDictionary(lang);

  return (
    <>
      <Header lang={lang} dict={dict} />
      <JsonLd data={breadcrumbJsonLd(lang, [["The Heure Society", ""], [dict.nav.collection, "/watches"]])} />
      <main className="mx-auto max-w-7xl px-5 pb-28 pt-36 md:px-10 md:pt-44">
        <header className="text-center">
          <GoldMonogram height={60} />
          <p className="eyebrow mt-6">{dict.catalog.eyebrow}</p>
          <CollectionTitle first={dict.catalog.titleA} second={dict.catalog.titleB} />
          {/* Ornamento: filetes dorados con un rombo, como en la tira de marcas */}
          <div className="mx-auto mt-8 flex max-w-xs items-center gap-4" aria-hidden>
            <span className="h-px flex-1 bg-gradient-to-r from-transparent to-brass/70" />
            <span className="h-1.5 w-1.5 rotate-45 bg-brass" />
            <span className="h-px flex-1 bg-gradient-to-l from-transparent to-brass/70" />
          </div>
          <p className="mx-auto mt-8 max-w-md font-display text-xl font-light italic leading-relaxed text-ivory/80 md:text-2xl">
            {dict.catalog.lead}
          </p>
        </header>

        <div className="mt-14">
          <Catalog watches={await getWatches()} brands={await getBrands()} lang={lang} dict={dict} />
        </div>
      </main>
      <Footer lang={lang} dict={dict} />
    </>
  );
}
