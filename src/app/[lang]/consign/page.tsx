import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { hasLocale } from "@/lib/i18n";
import { getDictionary } from "../dictionaries";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { SellForm } from "@/components/SellForm";

export async function generateMetadata({ params }: PageProps<"/[lang]/consign">): Promise<Metadata> {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  const dict = await getDictionary(lang);
  return {
    title: `${dict.nav.consign} — The Heure Society`,
    description: dict.consign.lead,
    alternates: { languages: { en: "/en/consign", es: "/es/consign" } },
  };
}

export default async function ConsignPage({ params }: PageProps<"/[lang]/consign">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const dict = await getDictionary(lang);
  const t = dict.consign;

  return (
    <>
      <Header lang={lang} dict={dict} />
      <main>
        {/* Presentación */}
        <section className="relative isolate overflow-hidden">
          <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_70%_80%_at_20%_30%,var(--color-emerald)_0%,var(--color-forest)_50%,var(--color-ink)_100%)]" />
          <div className="mx-auto max-w-7xl px-5 pb-24 pt-36 md:px-10 md:pb-28 md:pt-44">
            <div>
              <p className="eyebrow">{t.eyebrow}</p>
              <h1 className="mt-5 max-w-4xl font-display text-5xl font-light leading-[1.05] md:text-7xl">{t.title}</h1>
              <p className="mt-7 max-w-lg leading-relaxed text-stone md:text-lg">{t.lead}</p>
              <a
                href="#consign"
                className="mt-10 inline-block bg-ivory px-8 py-4 text-[0.72rem] tracking-[0.24em] uppercase text-ink transition-colors hover:bg-brass"
              >
                {t.cta}
              </a>
            </div>
          </div>
        </section>

        {/* Por qué consignar */}
        <section className="mx-auto max-w-7xl px-5 py-24 md:px-10">
          <h2 className="text-[0.72rem] tracking-[0.26em] uppercase text-brass">{t.whyTitle}</h2>
          <div className="mt-10 grid gap-px bg-line md:grid-cols-3">
            {t.why.map((w) => (
              <div key={w.title} className="bg-ink p-8 md:p-10">
                <h3 className="font-display text-3xl font-light">{w.title}</h3>
                <p className="mt-4 text-sm leading-relaxed text-stone">{w.text}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Cómo funciona */}
        <section className="border-y border-line bg-forest">
          <div className="mx-auto max-w-7xl px-5 py-20 md:px-10">
            <h2 className="text-[0.72rem] tracking-[0.26em] uppercase text-brass">{t.stepsTitle}</h2>
            <ol className="mt-10 grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
              {t.steps.map((s, i) => (
                <li key={s.title} className="border-t border-brass/40 pt-6">
                  <p className="font-display text-4xl text-brass/80">0{i + 1}</p>
                  <h3 className="mt-4 font-display text-2xl">{s.title}</h3>
                  <p className="mt-3 text-sm leading-relaxed text-stone">{s.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Vender o consignar */}
        <section className="mx-auto max-w-4xl px-5 py-24 md:px-10">
          <h2 className="text-center font-display text-4xl font-light md:text-5xl">{t.compareTitle}</h2>
          <div className="mt-12 overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead>
                <tr className="border-b border-line">
                  <th className="w-1/4 py-4" />
                  <th className="py-4 text-[0.68rem] font-normal tracking-[0.22em] uppercase text-stone">{t.compareSell}</th>
                  <th className="py-4 text-[0.68rem] font-normal tracking-[0.22em] uppercase text-brass">{t.compareConsign}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {t.compareRows.map(([label, sell, consign]) => (
                  <tr key={label}>
                    <th className="py-5 pr-4 text-[0.68rem] font-normal tracking-[0.18em] uppercase text-stone">{label}</th>
                    <td className="py-5 pr-4 text-stone">{sell}</td>
                    <td className="py-5">{consign}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-8 text-center text-sm text-stone">
            {t.compareSellCta}{" "}
            <Link href={`/${lang}/sell`} className="border-b border-brass/60 text-ivory hover:border-ivory">
              {dict.nav.sell}
            </Link>
          </p>
        </section>

        {/* Formulario + preguntas */}
        <section id="consign" className="border-t border-line">
          <div className="mx-auto grid max-w-7xl scroll-mt-8 gap-16 px-5 py-24 md:px-10 lg:grid-cols-[1fr_1.6fr] lg:gap-24">
            <div className="lg:sticky lg:top-8 lg:self-start">
              <h2 className="font-display text-4xl font-light md:text-5xl">{t.formTitle}</h2>
              <p className="mt-6 border-l border-brass/50 pl-4 text-sm leading-relaxed text-stone">{t.termsNote}</p>

              <h3 className="mt-12 text-[0.7rem] tracking-[0.26em] uppercase text-brass">{t.faqTitle}</h3>
              <div className="mt-4 divide-y divide-line border-y border-line">
                {t.faq.map((f) => (
                  <details key={f.q} className="group py-4">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm [&::-webkit-details-marker]:hidden">
                      {f.q}
                      <span className="text-brass transition-transform group-open:rotate-45">+</span>
                    </summary>
                    <p className="mt-3 text-sm leading-relaxed text-stone">{f.a}</p>
                  </details>
                ))}
              </div>
            </div>
            <div className="min-w-0">
              <SellForm dict={dict} variant="consign" />
            </div>
          </div>
        </section>
      </main>
      <Footer lang={lang} dict={dict} />
    </>
  );
}
