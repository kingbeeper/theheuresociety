import Link from "next/link";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/app/[lang]/dictionaries";
import { Monogram } from "./Monogram";
import { contact } from "@/lib/site";

export function Footer({ lang, dict }: { lang: Locale; dict: Dictionary }) {
  return (
    <footer className="border-t border-line bg-forest">
      <div className="mx-auto grid max-w-7xl gap-12 px-5 py-16 md:grid-cols-[1.5fr_1fr_1fr] md:px-10">
        <div className="space-y-5">
          <Monogram size={44} />
          <p className="font-display text-2xl tracking-[0.14em] uppercase">The Heure Society</p>
          <p className="max-w-xs text-sm text-stone">{dict.footer.tagline}</p>
          <address className="space-y-1 text-sm not-italic text-stone">
            <a className="block hover:text-ivory" href={contact.mapsUrl} target="_blank" rel="noreferrer">
              {contact.address.street}
              <br />
              {contact.address.city}, {contact.address.region} {contact.address.postalCode}
            </a>
            <a className="block hover:text-ivory" href={`tel:${contact.phoneE164}`}>{contact.phoneDisplay}</a>
          </address>
        </div>

        <ul className="space-y-3 text-sm text-stone">
          <li><Link className="hover:text-ivory" href={`/${lang}/watches`}>{dict.nav.collection}</Link></li>
          <li><Link className="hover:text-ivory" href={`/${lang}/sell`}>{dict.nav.sell}</Link></li>
          <li><Link className="hover:text-ivory" href={`/${lang}/consign`}>{dict.nav.consign}</Link></li>
          <li><Link className="hover:text-ivory" href={`/${lang}/appointments`}>{dict.nav.book}</Link></li>
          <li><Link className="hover:text-ivory" href={`/${lang}/contact`}>{dict.nav.contact}</Link></li>
        </ul>

        <ul className="space-y-3 text-sm text-stone">
          <li><a className="hover:text-ivory" href={contact.instagram} target="_blank" rel="noreferrer">Instagram</a></li>
          <li><a className="hover:text-ivory" href={`https://wa.me/${contact.whatsapp}`} target="_blank" rel="noreferrer">WhatsApp</a></li>
        </ul>
      </div>

      <div className="border-t border-line">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-5 py-6 text-[0.7rem] text-stone/70 md:flex-row md:justify-between md:px-10">
          <p>© The Heure Society. {dict.footer.rights}</p>
          <p>{dict.footer.disclaimer}</p>
        </div>
      </div>
    </footer>
  );
}
