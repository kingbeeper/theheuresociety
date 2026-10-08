import Image from "next/image";
import Link from "next/link";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/app/[lang]/dictionaries";
import { formatPrice, type Watch } from "@/lib/watches";
import { Monogram } from "./Monogram";

export function WatchCard({
  watch,
  lang,
  dict,
}: {
  watch: Watch;
  lang: Locale;
  dict: Dictionary;
}) {
  const extras = watch.hasBox && watch.hasPapers
    ? dict.watch.boxPapers
    : watch.hasBox
      ? dict.watch.box
      : dict.watch.none;

  return (
    <Link href={`/${lang}/watches/${watch.slug}`} className="group block">
      <div className="relative aspect-[4/5] overflow-hidden bg-[radial-gradient(ellipse_at_center,var(--color-emerald)_0%,var(--color-moss)_55%,var(--color-forest)_100%)]">
        {watch.images[0] ? (
          <Image
            src={watch.images[0]}
            alt={`${watch.brand} ${watch.model} ${watch.reference}`}
            fill
            sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
            className="object-cover transition-transform duration-700 group-hover:scale-[1.04]"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center opacity-25 transition-opacity duration-500 group-hover:opacity-40">
            <Monogram size={70} />
          </div>
        )}

        {watch.status !== "available" && (
          <span className="absolute left-4 top-4 bg-ink/80 px-3 py-1.5 text-[0.66rem] tracking-[0.22em] uppercase text-brass backdrop-blur">
            {dict.watch[watch.status]}
          </span>
        )}
      </div>

      <div className="mt-5 space-y-1.5">
        <p className="text-[0.66rem] tracking-[0.28em] uppercase text-stone">{watch.brand}</p>
        <h3 className="font-display text-2xl leading-tight text-ivory">{watch.model}</h3>
        <p className="text-xs text-stone">
          Ref. {watch.reference} · {watch.caseSize} · {extras}
        </p>
        <p className="pt-1 text-sm tracking-wide text-ivory">{formatPrice(watch, lang)}</p>
      </div>
    </Link>
  );
}
