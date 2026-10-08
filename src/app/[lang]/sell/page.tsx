import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasLocale } from "@/lib/i18n";
import { pageMetadata } from "@/lib/seo";
import { getDictionary } from "../dictionaries";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { SellForm } from "@/components/SellForm";

export async function generateMetadata({ params }: PageProps<"/[lang]/sell">): Promise<Metadata> {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  const dict = await getDictionary(lang);
  return pageMetadata(lang, "/sell", {
    title: `${dict.nav.sell} — The Heure Society`,
    description: dict.sell.lead,
  });
}

export default async function SellPage({ params }: PageProps<"/[lang]/sell">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const dict = await getDictionary(lang);
  const t = dict.sell;

  return (
    <>
      <Header lang={lang} dict={dict} />
      <main>
        {/* Presentación */}
        <section className="relative isolate overflow-hidden">
          <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_70%_80%_at_80%_30%,var(--color-emerald)_0%,var(--color-forest)_50%,var(--color-ink)_100%)]" />
          <div className="mx-auto max-w-7xl px-5 pb-24 pt-36 md:px-10 md:pb-28 md:pt-44">
            <div>
              <p className="eyebrow">{t.eyebrow}</p>
              <h1 className="mt-5 max-w-4xl font-display text-5xl font-light leading-[1.05] md:text-7xl">{t.title}</h1>
              <p className="mt-7 max-w-lg leading-relaxed text-stone md:text-lg">{t.lead}</p>
              <a
                href="#offer"
                className="mt-10 inline-block bg-ivory px-8 py-4 text-[0.72rem] tracking-[0.24em] uppercase text-ink transition-colors hover:bg-brass"
              >
                {t.cta}
              </a>
            </div>
          </div>
        </section>

        {/* Cómo funciona */}
        <section className="border-y border-line bg-forest">
          <div className="mx-auto max-w-7xl px-5 py-20 md:px-10">
            <h2 className="text-[0.72rem] tracking-[0.26em] uppercase text-brass">{t.stepsTitle}</h2>
            <ol className="mt-10 grid gap-10 md:grid-cols-3">
              {t.steps.map((s, i) => (
                <li key={s.title}>
                  <p className="font-display text-4xl text-brass/80">0{i + 1}</p>
                  <h3 className="mt-4 font-display text-2xl">{s.title}</h3>
                  <p className="mt-3 text-sm leading-relaxed text-stone">{s.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Formulario */}
        <section id="offer" className="mx-auto grid max-w-7xl scroll-mt-8 gap-16 px-5 py-24 md:px-10 lg:grid-cols-[1fr_1.6fr] lg:gap-24">
          <div className="lg:sticky lg:top-8 lg:self-start">
            <h2 className="font-display text-4xl font-light md:text-5xl">{t.formTitle}</h2>
            <div className="mt-10 border-t border-line pt-8">
              <h3 className="text-[0.7rem] tracking-[0.26em] uppercase text-brass">{t.buyTitle}</h3>
              <p className="mt-4 leading-relaxed text-stone">{t.buyText}</p>
            </div>
          </div>
          <div className="min-w-0">
            <SellForm dict={dict} />
          </div>
        </section>
      </main>
      <Footer lang={lang} dict={dict} />
    </>
  );
}
