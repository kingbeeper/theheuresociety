"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { locales, type Locale } from "@/lib/i18n";

export function LanguageSwitch({ current }: { current: Locale }) {
  const pathname = usePathname();

  return (
    <div className="flex items-center gap-2 text-[0.7rem] tracking-[0.2em]">
      {locales.map((l, i) => {
        const href = pathname.replace(/^\/(en|es)(?=\/|$)/, `/${l}`);
        return (
          <span key={l} className="flex items-center gap-2">
            {i > 0 && <span className="text-line">/</span>}
            <Link
              href={href}
              hrefLang={l}
              // Recordar la elección para que el proxy no la sobrescriba
              onClick={() => {
                document.cookie = `locale=${l}; path=/; max-age=31536000; samesite=lax`;
              }}
              className={
                l === current
                  ? "text-ivory"
                  : "text-stone transition-colors hover:text-ivory"
              }
            >
              {l.toUpperCase()}
            </Link>
          </span>
        );
      })}
    </div>
  );
}
