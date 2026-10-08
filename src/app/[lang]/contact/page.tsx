import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { hasLocale } from "@/lib/i18n";
import { pageMetadata } from "@/lib/seo";
import { contact } from "@/lib/site";
import { getDictionary } from "../dictionaries";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { GoldMonogram } from "@/components/GoldMonogram";

export async function generateMetadata({ params }: PageProps<"/[lang]/contact">): Promise<Metadata> {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  const dict = await getDictionary(lang);
  return pageMetadata(lang, "/contact", {
    title: `${dict.nav.contact} — The Heure Society`,
    description: dict.contact.lead,
  });
}

export default async function ContactPage({ params }: PageProps<"/[lang]/contact">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const dict = await getDictionary(lang);
  const t = dict.contact;
  const a = contact.address;

  const channels = [
    { label: t.call, value: contact.phoneDisplay, href: `tel:${contact.phoneE164}`, external: false },
    { label: "WhatsApp", value: t.whatsappValue, href: `https://wa.me/${contact.whatsapp}?text=${encodeURIComponent(t.whatsappMessage)}`, external: true },
    { label: t.visit, value: t.visitValue, href: `/${lang}/appointments?type=office`, external: false },
  ];

  return (
    <>
      <Header lang={lang} dict={dict} />

      <main className="mx-auto max-w-7xl px-5 pb-28 pt-36 md:px-10 md:pt-44">
        <header className="text-center">
          <GoldMonogram height={60} />
          <p className="eyebrow mt-6">The Heure Society</p>
          <h1 className="mt-5 font-display text-5xl font-light leading-none md:text-7xl">
            {t.titleA}{" "}
            <em className="bg-[linear-gradient(135deg,#d8bf80_0%,#b08f4a_35%,#8a6d33_60%,#c4a462_85%)] bg-clip-text pr-[0.08em] font-light text-transparent">
              {t.titleB}
            </em>
          </h1>
          <div className="mx-auto mt-8 flex max-w-xs items-center gap-4" aria-hidden>
            <span className="h-px flex-1 bg-gradient-to-r from-transparent to-brass/70" />
            <span className="h-1.5 w-1.5 rotate-45 bg-brass" />
            <span className="h-px flex-1 bg-gradient-to-l from-transparent to-brass/70" />
          </div>
          <p className="mx-auto mt-8 max-w-lg font-display text-xl font-light italic leading-relaxed text-ivory/80 md:text-2xl">
            {t.lead}
          </p>
        </header>

        {/* Formas de contacto */}
        <div className="mx-auto mt-16 grid max-w-5xl gap-px bg-line md:grid-cols-3">
          {channels.map((c) => {
            const inner = (
              <>
                <span className="text-[0.66rem] tracking-[0.26em] uppercase text-brass">{c.label}</span>
                <span className="mt-3 block font-display text-2xl">{c.value}</span>
                <span className="mt-6 block text-[0.62rem] tracking-[0.24em] uppercase text-stone transition-colors group-hover:text-ivory">
                  {t.go} →
                </span>
              </>
            );
            return c.external ? (
              <a key={c.label} href={c.href} target="_blank" rel="noreferrer" className="group bg-ink px-8 py-10 transition-colors hover:bg-forest">
                {inner}
              </a>
            ) : (
              <Link key={c.label} href={c.href} className="group bg-ink px-8 py-10 transition-colors hover:bg-forest">
                {inner}
              </Link>
            );
          })}
        </div>

        {/* Oficina y mapa */}
        <section className="mx-auto mt-20 grid max-w-5xl gap-10 lg:grid-cols-[1fr_1.4fr] lg:gap-14">
          <div>
            <h2 className="text-[0.7rem] tracking-[0.26em] uppercase text-brass">{t.office}</h2>
            <address className="mt-5 font-display text-2xl not-italic leading-snug">
              {a.street}
              <br />
              {a.city}, {a.region} {a.postalCode}
            </address>
            <p className="mt-4 border-l border-brass/50 pl-4 text-sm leading-relaxed text-stone">{t.byAppointment}</p>

            <h2 className="mt-10 text-[0.7rem] tracking-[0.26em] uppercase text-brass">{t.hours}</h2>
            <dl className="mt-4 space-y-2 text-sm">
              {t.hoursList.map(([day, time]) => (
                <div key={day} className="flex justify-between gap-6 border-b border-line pb-2">
                  <dt className="text-stone">{day}</dt>
                  <dd>{time}</dd>
                </div>
              ))}
            </dl>

            <div className="mt-10 flex flex-wrap gap-3">
              <Link
                href={`/${lang}/appointments?type=office`}
                className="bg-ivory px-6 py-3.5 text-[0.7rem] tracking-[0.22em] uppercase text-ink transition-colors hover:bg-brass"
              >
                {t.book}
              </Link>
              <a
                href={contact.mapsUrl}
                target="_blank"
                rel="noreferrer"
                className="border border-ivory/30 px-6 py-3.5 text-[0.7rem] tracking-[0.22em] uppercase transition-colors hover:border-ivory"
              >
                {t.directions}
              </a>
            </div>
          </div>

          {/* Mapa en tonos oscuros (filtro sobre el mapa de Google) */}
          <div className="relative aspect-[4/3] overflow-hidden border border-line lg:aspect-auto lg:min-h-[420px]">
            <iframe
              title={t.mapTitle}
              src={contact.mapEmbed}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              className="absolute inset-0 h-full w-full [filter:invert(90%)_hue-rotate(180deg)_saturate(0.6)_brightness(0.9)]"
            />
            {/* Marcador dorado de la oficina (el mapa se centra en la dirección) */}
            <span className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-full" aria-hidden>
              <span className="flex h-12 w-12 items-center justify-center rounded-full border border-brass bg-ink/90 shadow-[0_0_0_6px_rgba(200,176,122,0.15),0_10px_25px_rgba(0,0,0,0.6)]">
                <GoldMonogram height={26} />
              </span>
              <span className="mx-auto block h-3 w-px bg-brass" />
            </span>
          </div>
        </section>
      </main>

      <Footer lang={lang} dict={dict} />
    </>
  );
}
