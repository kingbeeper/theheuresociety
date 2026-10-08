import Link from "next/link";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/app/[lang]/dictionaries";
import { Monogram } from "./Monogram";
import { contact } from "@/lib/site";

// Pie centrado y simétrico, como el resto de la web: marca, enlaces en una fila,
// datos de contacto y redes, y la línea legal
export function Footer({ lang, dict }: { lang: Locale; dict: Dictionary }) {
  const nav = [
    { href: `/${lang}/watches`, label: dict.nav.collection },
    { href: `/${lang}/sell`, label: dict.nav.sell },
    { href: `/${lang}/consign`, label: dict.nav.consign },
    { href: `/${lang}/appointments`, label: dict.nav.book },
    { href: `/${lang}/contact`, label: dict.nav.contact },
  ];
  const dot = <span className="inline-block h-1 w-1 rotate-45 bg-brass/60 align-middle" aria-hidden />;

  return (
    <footer className="border-t border-line bg-forest">
      <div className="mx-auto flex max-w-5xl flex-col items-center px-5 py-16 text-center md:px-10 md:py-20">
        <Monogram size={44} />
        <p className="mt-5 font-display text-2xl tracking-[0.14em] uppercase">The Heure Society</p>
        <p className="mt-3 max-w-xs text-sm text-stone">{dict.footer.tagline}</p>

        <nav className="mt-10 flex flex-col items-center gap-4 text-[0.7rem] tracking-[0.22em] uppercase md:flex-row md:flex-wrap md:justify-center md:gap-x-6 md:gap-y-3">
          {nav.map((item, i) => (
            <span key={item.href} className="flex items-center gap-6">
              {i > 0 && <span className="hidden md:inline-flex">{dot}</span>}
              <Link className="text-ivory/85 transition-colors hover:text-brass" href={item.href}>
                {item.label}
              </Link>
            </span>
          ))}
        </nav>

        <div className="mt-10 flex w-full max-w-xs items-center gap-4" aria-hidden>
          <span className="h-px flex-1 bg-gradient-to-r from-transparent to-brass/50" />
          <span className="h-1.5 w-1.5 rotate-45 bg-brass/80" />
          <span className="h-px flex-1 bg-gradient-to-l from-transparent to-brass/50" />
        </div>

        <address className="mt-10 flex flex-col items-center gap-x-6 gap-y-2 text-sm not-italic text-stone md:flex-row">
          <a className="hover:text-ivory" href={contact.mapsUrl} target="_blank" rel="noreferrer">
            {contact.address.street}, {contact.address.city}, {contact.address.region} {contact.address.postalCode}
          </a>
          <span className="hidden md:inline">{dot}</span>
          <a className="hover:text-ivory" href={`tel:${contact.phoneE164}`}>{contact.phoneDisplay}</a>
        </address>

        <div className="mt-5 flex items-center gap-6 text-[0.7rem] tracking-[0.22em] uppercase">
          <a className="text-brass transition-colors hover:text-ivory" href={contact.instagram} target="_blank" rel="noreferrer">Instagram</a>
          {dot}
          <a className="text-brass transition-colors hover:text-ivory" href={`https://wa.me/${contact.whatsapp}`} target="_blank" rel="noreferrer">WhatsApp</a>
        </div>
      </div>

      <div className="border-t border-line">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-2 px-5 py-6 text-center text-[0.7rem] text-stone/70 md:px-10">
          <p>© The Heure Society. {dict.footer.rights}</p>
          <p>{dict.footer.disclaimer}</p>
        </div>
      </div>
    </footer>
  );
}
