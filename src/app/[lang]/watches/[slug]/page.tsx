import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { hasLocale } from "@/lib/i18n";
import { breadcrumbJsonLd, JsonLd, pageMetadata, SITE_URL } from "@/lib/seo";
import { formatPrice, whatsappLink } from "@/lib/watches";
import { getWatch, getWatches } from "@/lib/inventory";
import { getDictionary } from "../../dictionaries";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Gallery } from "@/components/Gallery";
import { WatchCard } from "@/components/WatchCard";

export async function generateStaticParams() {
  return (await getWatches()).map((w) => ({ slug: w.slug }));
}

export async function generateMetadata({
  params,
}: PageProps<"/[lang]/watches/[slug]">): Promise<Metadata> {
  const { lang, slug } = await params;
  const watch = await getWatch(slug);
  if (!hasLocale(lang) || !watch) return {};
  const name = `${watch.brand} ${watch.model} ${watch.reference}`;
  return pageMetadata(lang, `/watches/${slug}`, {
    title: `${name} — The Heure Society`,
    description: watch.description?.[lang] ?? `${name}, ${watch.caseSize}, ${watch.material[lang]}.`,
    images: watch.images.slice(0, 1),
  });
}

export default function WatchPage({ params }: PageProps<"/[lang]/watches/[slug]">) {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <WatchDetail params={params} />
    </Suspense>
  );
}

async function WatchDetail({ params }: { params: PageProps<"/[lang]/watches/[slug]">["params"] }) {
  const { lang, slug } = await params;
  if (!hasLocale(lang)) notFound();
  const watch = await getWatch(slug);
  if (!watch) notFound();
  const dict = await getDictionary(lang);
  const t = dict.detail;
  const name = `${watch.brand} ${watch.model}`;

  const set = [watch.hasBox && t.boxYes, watch.hasPapers && t.papersYes].filter(Boolean).join(" · ");
  const specs: [string, string | undefined][] = [
    [t.reference, watch.reference],
    [t.case, watch.caseSize],
    [t.material, watch.material[lang]],
    [t.dial, watch.dial?.[lang]],
    [t.bracelet, watch.bracelet?.[lang]],
    [t.movement, watch.movement],
    [t.powerReserve, watch.powerReserve],
    [t.waterResistance, watch.waterResistance],
    [t.year, watch.year?.toString()],
    [t.set, set || t.notIncluded],
  ];

  const related = (await getWatches())
    .filter((w) => w.slug !== watch.slug)
    .sort((a, b) => Number(b.brand === watch.brand) - Number(a.brand === watch.brand))
    .slice(0, 3);

  // Datos estructurados para que Google muestre la ficha como producto. Una oferta sin precio
  // no es válida para Google: con «Precio a consultar» se publica el producto sin oferta.
  const url = `${SITE_URL}/${lang}/watches/${watch.slug}`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: `${name} ${watch.reference}`,
    url,
    brand: { "@type": "Brand", name: watch.brand },
    sku: watch.reference,
    mpn: watch.reference,
    image: watch.images.map((src) => (src.startsWith("http") ? src : `${SITE_URL}${src}`)),
    description: watch.description?.[lang],
    ...(watch.price != null && {
      offers: {
        "@type": "Offer",
        url,
        price: watch.price,
        priceCurrency: watch.currency,
        availability:
          watch.status === "sold"
            ? "https://schema.org/SoldOut"
            : watch.status === "reserved"
              ? "https://schema.org/LimitedAvailability"
              : "https://schema.org/InStock",
        itemCondition: "https://schema.org/UsedCondition",
        seller: { "@id": `${SITE_URL}/#store` },
      },
    }),
  };
  const breadcrumbs = breadcrumbJsonLd(lang, [
    ["The Heure Society", ""],
    [dict.nav.collection, "/watches"],
    [`${name} ${watch.reference}`, `/watches/${watch.slug}`],
  ]);

  return (
    <>
      <Header lang={lang} dict={dict} />
      <JsonLd data={jsonLd} />
      <JsonLd data={breadcrumbs} />

      <main className="mx-auto max-w-7xl px-5 pb-28 pt-32 md:px-10 md:pt-40">
        <Link
          href={`/${lang}/watches`}
          className="text-[0.68rem] tracking-[0.22em] uppercase text-stone transition-colors hover:text-ivory"
        >
          ← {t.back}
        </Link>

        <div className="mt-10 grid gap-12 lg:grid-cols-2 lg:gap-20">
          <Gallery images={watch.images} alt={`${name} ${watch.reference}`} photoLabel={t.photo} />

          <div>
            <p className="eyebrow">{watch.brand}</p>
            <h1 className="mt-4 font-display text-5xl font-light leading-[1.05] md:text-6xl">{watch.model}</h1>
            <p className="mt-3 text-sm tracking-wide text-stone">
              Ref. {watch.reference} · {watch.caseSize} · {watch.material[lang]}
            </p>

            <div className="mt-8 flex items-center gap-4">
              <p className="text-2xl tracking-wide">{formatPrice(watch, lang)}</p>
              {watch.status !== "available" && (
                <span className="border border-brass/50 px-3 py-1 text-[0.62rem] tracking-[0.22em] uppercase text-brass">
                  {dict.watch[watch.status]}
                </span>
              )}
            </div>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a
                href={whatsappLink(
                  t.whatsappMessage.replace("{watch}", name).replace("{ref}", watch.reference)
                )}
                target="_blank"
                rel="noreferrer"
                className="flex-1 bg-ivory px-6 py-4 text-center text-[0.72rem] tracking-[0.22em] uppercase text-ink transition-colors hover:bg-brass"
              >
                {t.whatsapp}
              </a>
              <Link
                href={`/${lang}/appointments?watch=${watch.slug}`}
                className="flex-1 border border-ivory/30 px-6 py-4 text-center text-[0.72rem] tracking-[0.22em] uppercase transition-colors hover:border-ivory"
              >
                {t.book}
              </Link>
            </div>

            {watch.description && (
              <p className="mt-10 leading-relaxed text-stone">{watch.description[lang]}</p>
            )}

            <h2 className="mt-12 text-[0.7rem] tracking-[0.26em] uppercase text-brass">{t.specs}</h2>
            <dl className="mt-4 divide-y divide-line border-y border-line">
              {specs
                .filter(([, v]) => v)
                .map(([label, value]) => (
                  <div key={label} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-4 py-3.5 text-sm">
                    <dt className="text-stone">{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
            </dl>

            <ul className="mt-10 space-y-3">
              {t.assurance.map((line) => (
                <li key={line} className="flex items-center gap-3 text-sm text-stone">
                  <span className="h-px w-5 bg-brass" />
                  {line}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <section className="mt-28 border-t border-line pt-16">
          <h2 className="font-display text-3xl font-light md:text-4xl">{t.related}</h2>
          <div className="mt-10 grid gap-x-8 gap-y-14 sm:grid-cols-2 lg:grid-cols-3">
            {related.map((w) => (
              <WatchCard key={w.slug} watch={w} lang={lang} dict={dict} />
            ))}
          </div>
        </section>
      </main>

      <Footer lang={lang} dict={dict} />
    </>
  );
}
