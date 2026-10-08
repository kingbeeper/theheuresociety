import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { hasLocale } from "@/lib/i18n";
import { pageMetadata } from "@/lib/seo";
import { getDictionary } from "./dictionaries";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { BrandMarquee } from "@/components/BrandMarquee";

export async function generateMetadata({ params }: PageProps<"/[lang]">): Promise<Metadata> {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  const dict = await getDictionary(lang);
  return pageMetadata(lang, "", { title: dict.meta.title, description: dict.meta.description });
}

export default async function Home({ params }: PageProps<"/[lang]">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const dict = await getDictionary(lang);

  return (
    <>
      <Header lang={lang} dict={dict} />

      <main>
        {/* Portada */}
        <section className="relative isolate flex min-h-[72svh] items-center overflow-hidden">
          <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_70%_60%_at_50%_55%,var(--color-emerald)_0%,var(--color-forest)_50%,var(--color-ink)_100%)]" />

          <div className="mx-auto w-full max-w-7xl px-5 pb-20 pt-36 text-center md:px-10 md:pt-40">
            <p className="eyebrow">{dict.hero.eyebrow}</p>
            <h1 className="mx-auto mt-6 max-w-4xl font-display text-5xl font-light leading-[1.02] md:text-7xl lg:text-8xl">
              {dict.hero.title}
            </h1>
            <p className="mx-auto mt-7 max-w-lg text-base leading-relaxed text-stone md:text-lg">
              {dict.hero.lead}
            </p>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-x-10 gap-y-6">
              <Link
                href={`/${lang}/watches`}
                className="bg-ivory px-8 py-4 text-[0.72rem] tracking-[0.24em] uppercase text-ink transition-colors hover:bg-brass"
              >
                {dict.hero.ctaPrimary}
              </Link>
              <Link
                href={`/${lang}/appointments`}
                className="border-b border-brass/60 pb-1 text-[0.72rem] tracking-[0.24em] uppercase text-ivory transition-colors hover:border-ivory"
              >
                {dict.hero.ctaSecondary}
              </Link>
            </div>
          </div>
        </section>

        {/* Marcas */}
        <BrandMarquee label={dict.marquee} />

        {/* Invitación a la colección (las piezas viven en /watches) */}
        <section className="mx-auto max-w-3xl px-5 py-28 text-center md:py-36">
          <p className="eyebrow">{dict.home.collectionEyebrow}</p>
          <h2 className="mt-5 font-display text-4xl font-light leading-tight md:text-6xl">
            {dict.home.collectionTitle}
          </h2>
          <p className="mx-auto mt-6 max-w-md leading-relaxed text-stone">{dict.home.collectionText}</p>
          <Link
            href={`/${lang}/watches`}
            className="mt-10 inline-block border-b border-brass/60 pb-1 text-[0.72rem] tracking-[0.24em] uppercase text-ivory transition-colors hover:border-ivory"
          >
            {dict.featured.viewAll} →
          </Link>
        </section>

        {/* Confianza: fila abierta, sin casillas */}
        <section className="mx-auto max-w-7xl px-5 pb-24 md:px-10 md:pb-32">
          <Ornament />
          <div className="mt-14 grid gap-12 text-center sm:grid-cols-2 lg:grid-cols-4 lg:gap-10">
            {dict.trust.items.map((item, i) => (
              <div key={item.title}>
                <p className="font-display text-4xl font-light italic text-brass/80">0{i + 1}</p>
                <h3 className="mt-4 text-[0.72rem] tracking-[0.26em] uppercase">{item.title}</h3>
                <p className="mx-auto mt-3 max-w-[16rem] text-sm leading-relaxed text-stone">{item.text}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Citas */}
        <section className="mx-auto grid max-w-7xl gap-14 px-5 py-24 md:px-10 md:py-32 lg:grid-cols-2 lg:items-center">
          <div>
            <p className="eyebrow">{dict.appointment.eyebrow}</p>
            <h2 className="mt-4 font-display text-4xl font-light leading-tight md:text-5xl">
              {dict.appointment.title}
            </h2>
            <p className="mt-6 max-w-md leading-relaxed text-stone">{dict.appointment.lead}</p>
          </div>

          <div className="border-t border-brass/25">
            {[
              { title: dict.appointment.office, text: dict.appointment.officeText, type: "office" },
              { title: dict.appointment.video, text: dict.appointment.videoText, type: "video" },
            ].map((opt) => (
              <Link
                key={opt.type}
                href={`/${lang}/appointments?type=${opt.type}`}
                className="group flex flex-col gap-4 border-b border-brass/25 py-8 sm:flex-row sm:items-center sm:justify-between sm:gap-8"
              >
                <div>
                  <h3 className="font-display text-3xl font-light transition-colors group-hover:text-brass">{opt.title}</h3>
                  <p className="mt-2 max-w-sm text-sm leading-relaxed text-stone">{opt.text}</p>
                </div>
                <span className="shrink-0 text-[0.68rem] tracking-[0.24em] uppercase text-brass transition-transform group-hover:translate-x-1">
                  {dict.appointment.cta} →
                </span>
              </Link>
            ))}
          </div>
        </section>

        {/* Vender o consignar: dos caminos, una sola sección */}
        <section className="relative isolate overflow-hidden">
          <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_60%_70%_at_50%_45%,var(--color-emerald)_0%,var(--color-ink)_75%)] opacity-60" />
          <div className="mx-auto max-w-5xl px-5 py-24 text-center md:px-10 md:py-32">
            <Ornament />
            <h2 className="mx-auto mt-10 max-w-2xl font-display text-4xl font-light md:text-6xl">{dict.sell.title}</h2>
            <div className="mt-16 grid gap-14 md:grid-cols-[1fr_auto_1fr] md:gap-12">
              <div>
                <p className="eyebrow">{dict.sell.eyebrow}</p>
                <p className="mx-auto mt-5 max-w-sm leading-relaxed text-stone">{dict.sell.lead}</p>
                <Link href={`/${lang}/sell`} className="mt-10 inline-block border-b border-brass/60 pb-1 text-[0.72rem] tracking-[0.24em] uppercase text-ivory transition-colors hover:border-ivory">
                  {dict.sell.cta} →
                </Link>
              </div>
              <span className="mx-auto hidden w-px bg-gradient-to-b from-transparent via-brass/50 to-transparent md:block" aria-hidden />
              <div>
                <p className="eyebrow">{dict.consign.teaser.eyebrow}</p>
                <p className="mx-auto mt-5 max-w-sm leading-relaxed text-stone">{dict.consign.teaser.text}</p>
                <Link href={`/${lang}/consign`} className="mt-10 inline-block border-b border-brass/60 pb-1 text-[0.72rem] tracking-[0.24em] uppercase text-ivory transition-colors hover:border-ivory">
                  {dict.consign.teaser.cta} →
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <Footer lang={lang} dict={dict} />
    </>
  );
}

// Adorno de separación: línea fina, rombo dorado, línea fina
function Ornament() {
  return (
    <div className="mx-auto flex max-w-xs items-center gap-4" aria-hidden>
      <span className="h-px flex-1 bg-gradient-to-r from-transparent to-brass/70" />
      <span className="h-1.5 w-1.5 rotate-45 bg-brass" />
      <span className="h-px flex-1 bg-gradient-to-l from-transparent to-brass/70" />
    </div>
  );
}
