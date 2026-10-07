import Link from "next/link";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/app/[lang]/dictionaries";
import { Monogram } from "./Monogram";
import { LanguageSwitch } from "./LanguageSwitch";

export function Header({ lang, dict }: { lang: Locale; dict: Dictionary }) {
  const links = [
    { href: `/${lang}/watches`, label: dict.nav.collection },
    { href: `/${lang}/sell`, label: dict.nav.sell },
    { href: `/${lang}/consign`, label: dict.nav.consign },
    { href: `/${lang}/about`, label: dict.nav.about },
    { href: `/${lang}/contact`, label: dict.nav.contact },
  ];

  return (
    <header className="absolute inset-x-0 top-0 z-30">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-8 px-5 py-6 md:px-10">
        <Link href={`/${lang}`} className="flex items-center gap-4">
          <Monogram size={30} priority />
          <span className="whitespace-nowrap font-display text-xl tracking-[0.18em] uppercase max-sm:hidden xl:text-lg xl:tracking-[0.14em]">
            The Heure Society
          </span>
        </Link>

        <nav className="hidden items-center gap-6 xl:flex">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="whitespace-nowrap text-[0.7rem] tracking-[0.16em] uppercase text-stone transition-colors hover:text-ivory"
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-6">
          <LanguageSwitch current={lang} />
          <Link
            href={`/${lang}/appointments`}
            className="hidden whitespace-nowrap border border-brass/60 px-5 py-2.5 text-[0.7rem] tracking-[0.22em] uppercase text-ivory transition-colors hover:bg-brass hover:text-ink sm:block"
          >
            {dict.nav.book}
          </Link>

          {/* Menú móvil sin JavaScript */}
          <details className="group relative xl:hidden">
            <summary className="flex h-9 w-9 cursor-pointer list-none flex-col items-center justify-center gap-1.5 [&::-webkit-details-marker]:hidden">
              <span className="h-px w-6 bg-ivory transition group-open:translate-y-[3.5px] group-open:rotate-45" />
              <span className="h-px w-6 bg-ivory transition group-open:-translate-y-[3.5px] group-open:-rotate-45" />
              <span className="sr-only">Menu</span>
            </summary>
            <div className="absolute right-0 mt-4 w-64 border border-line bg-forest/95 p-6 backdrop-blur">
              <ul className="space-y-5">
                {[...links, { href: `/${lang}/appointments`, label: dict.nav.book }].map((l) => (
                  <li key={l.href}>
                    <Link href={l.href} className="text-xs tracking-[0.22em] uppercase text-ivory">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </details>
        </div>
      </div>
    </header>
  );
}
