import Link from "next/link";
import { notFound } from "next/navigation";
import { hasLocale } from "@/lib/i18n";
import { getDictionary } from "./dictionaries";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { BrandMarquee } from "@/components/BrandMarquee";

export default async function Home({ params }: PageProps<"/[lang]">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const dict = await getDictionary(lang);

  return (
    <>
      <Header lang={lang} dict={dict} />

      <main>
        {/* Portada */}
        <section className="relative isolate flex min-h-[88svh] items-center overflow-hidden">
          <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_70%_60%_at_50%_55%,var(--color-emerald)_0%,var(--color-forest)_50%,var(--color-ink)_100%)]" />

          <div className="mx-auto w-full max-w-7xl px-5 pb-20 pt-36 text-center md:px-10 md:pt-40">
            <p className="eyebrow">{dict.hero.eyebrow}</p>
            <h1 className="mx-auto mt-6 max-w-4xl font-display text-5xl font-light leading-[1.02] md:text-7xl lg:text-8xl">
              {dict.hero.title}
            </h1>
            <p className="mx-auto mt-7 max-w-lg text-base leading-relaxed text-stone md:text-lg">
              {dict.hero.lead}
            </p>
            <div className="mt-10 flex flex-wrap justify-center gap-4">
              <Link
                href={`/${lang}/watches`}
                className="bg-ivory px-8 py-4 text-[0.72rem] tracking-[0.24em] uppercase text-ink transition-colors hover:bg-brass"
              >
                {dict.hero.ctaPrimary}
              </Link>
              <Link
                href={`/${lang}/appointments`}
                className="border border-ivory/30 px-8 py-4 text-[0.72rem] tracking-[0.24em] uppercase text-ivory transition-colors hover:border-ivory"
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

        {/* Confianza */}
        <section className="bg-forest">
          <div className="mx-auto grid max-w-7xl gap-px bg-line px-0 sm:grid-cols-2 lg:grid-cols-4">
            {dict.trust.items.map((item, i) => (
              <div key={item.title} className="bg-forest px-8 py-14 md:px-10">
                <p className="font-display text-3xl text-brass/80">0{i + 1}</p>
                <h3 className="mt-5 text-[0.75rem] tracking-[0.24em] uppercase">{item.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-stone">{item.text}</p>
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

          <div className="grid gap-5 sm:grid-cols-2">
            {[
              { title: dict.appointment.office, text: dict.appointment.officeText, type: "office" },
              { title: dict.appointment.video, text: dict.appointment.videoText, type: "video" },
            ].map((opt) => (
              <Link
                key={opt.type}
                href={`/${lang}/appointments?type=${opt.type}`}
                className="group flex flex-col justify-between border border-line bg-moss/40 p-8 transition-colors hover:border-brass/60"
              >
                <div>
                  <h3 className="font-display text-2xl">{opt.title}</h3>
                  <p className="mt-3 text-sm leading-relaxed text-stone">{opt.text}</p>
                </div>
                <span className="mt-10 text-[0.68rem] tracking-[0.24em] uppercase text-brass transition-transform group-hover:translate-x-1">
                  {dict.appointment.cta} →
                </span>
              </Link>
            ))}
          </div>
        </section>

        {/* Consignación */}
        <section className="mx-auto max-w-7xl px-5 pb-24 md:px-10 md:pb-32">
          <Link
            href={`/${lang}/consign`}
            className="group grid items-center gap-8 border border-line bg-forest/60 p-8 transition-colors hover:border-brass/50 md:grid-cols-[1fr_auto] md:p-12"
          >
            <div>
              <p className="eyebrow">{dict.consign.teaser.eyebrow}</p>
              <h2 className="mt-4 font-display text-3xl font-light md:text-4xl">{dict.consign.teaser.title}</h2>
              <p className="mt-4 max-w-xl text-sm leading-relaxed text-stone">{dict.consign.teaser.text}</p>
            </div>
            <span className="text-[0.7rem] tracking-[0.24em] uppercase text-brass transition-transform group-hover:translate-x-1">
              {dict.consign.teaser.cta} →
            </span>
          </Link>
        </section>

        {/* Vende tu reloj */}
        <section className="relative isolate overflow-hidden border-t border-line">
          <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_20%_50%,var(--color-emerald)_0%,var(--color-ink)_70%)] opacity-70" />
          <div className="mx-auto max-w-7xl px-5 py-24 text-center md:px-10 md:py-32">
            <p className="eyebrow">{dict.sell.eyebrow}</p>
            <h2 className="mx-auto mt-4 max-w-2xl font-display text-4xl font-light md:text-6xl">
              {dict.sell.title}
            </h2>
            <p className="mx-auto mt-6 max-w-md leading-relaxed text-stone">{dict.sell.lead}</p>
            <Link
              href={`/${lang}/sell`}
              className="mt-10 inline-block bg-ivory px-8 py-4 text-[0.72rem] tracking-[0.24em] uppercase text-ink transition-colors hover:bg-brass"
            >
              {dict.sell.cta}
            </Link>
          </div>
        </section>
      </main>

      <Footer lang={lang} dict={dict} />
    </>
  );
}
