"use client";

import Image from "next/image";
import Link from "next/link";
import cutouts from "@/data/cutouts.json";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/app/[lang]/dictionaries";
import { formatPrice, type Watch } from "@/lib/watches";
import { packIntoCases, type Slot } from "@/lib/cases";
import { Monogram } from "./Monogram";

const CUTOUTS = cutouts as Record<string, string>;

// Los recortes son 600×1200 con la caja del reloj ocupando el 62 % del ancho.
// Con este ancho (respecto al cojín) la caja del reloj ocupa ~95 % del cojín.
const CUTOUT_WIDTH = 153; // % del ancho del cojín

export function CollectionCase({ watches, lang, dict }: { watches: Watch[]; lang: Locale; dict: Dictionary }) {
  const cases = packIntoCases(watches);

  return (
    <div className="space-y-16">
      {cases.map(({ layout, items }, i) => (
        <div
          key={`${layout.id}-${i}`}
          className="relative mx-auto max-w-6xl overflow-hidden shadow-[0_40px_80px_-20px_rgba(0,0,0,0.8)]"
          style={{ aspectRatio: `${layout.width} / ${layout.height}` }}
        >
          <Image
            src={layout.image}
            alt=""
            fill
            priority={i === 0}
            sizes="(min-width: 1152px) 1152px, 100vw"
            className="object-cover"
          />
          {items.map((watch, s) => (
            <CaseSlot key={watch.slug} watch={watch} slot={layout.slots[s]} lang={lang} dict={dict} />
          ))}
        </div>
      ))}
    </div>
  );
}

function CaseSlot({ watch, slot, lang, dict }: { watch: Watch; slot: Slot; lang: Locale; dict: Dictionary }) {
  const cutout = CUTOUTS[watch.slug];
  const name = `${watch.brand} ${watch.model}`;

  return (
    <Link
      href={`/${lang}/watches/${watch.slug}`}
      aria-label={`${name}, ${formatPrice(watch, lang)}`}
      className="group absolute focus-visible:outline-none"
      style={{ left: `${slot.x}%`, top: `${slot.y}%`, width: `${slot.w}%`, height: `${slot.h}%` }}
    >
      {cutout ? (
        // La correa "se va" por los bordes curvos del cojín: se difumina arriba y abajo
        <span
          className="absolute inset-y-0 -left-1/4 -right-1/4 [mask-image:linear-gradient(to_bottom,transparent_0%,black_9%,black_91%,transparent_100%)]"
        >
          <Image
            src={cutout}
            alt=""
            width={600}
            height={1200}
            sizes="(min-width: 1152px) 260px, 22vw"
            className="absolute left-1/2 top-1/2 h-auto max-w-none -translate-x-1/2 -translate-y-1/2 drop-shadow-[0_14px_14px_rgba(0,0,0,0.65)] transition duration-500 group-hover:-translate-y-[51.5%] group-hover:brightness-110 group-focus-visible:brightness-110"
            style={{ width: `${(CUTOUT_WIDTH / 150) * 100}%` }}
          />
        </span>
      ) : (
        <span className="absolute inset-0 flex items-center justify-center opacity-30 transition-opacity group-hover:opacity-60">
          <Monogram size={44} />
        </span>
      )}

      {watch.status !== "available" && (
        <span className="absolute left-1/2 top-[6%] -translate-x-1/2 whitespace-nowrap bg-ink/85 px-2 py-1 text-[0.5rem] tracking-[0.2em] uppercase text-brass sm:text-[0.6rem]">
          {dict.watch[watch.status]}
        </span>
      )}

      {/* Rótulo: aparece al pasar el ratón; en pantallas táctiles, siempre visible */}
      <span className="pointer-events-none absolute inset-x-[-12%] bottom-[3%] max-sm:hidden translate-y-1 bg-ink/85 px-2 py-2 text-center opacity-0 backdrop-blur-sm transition duration-300 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100 [@media(hover:none)]:translate-y-0 [@media(hover:none)]:opacity-100">
        <span className="block text-[0.5rem] tracking-[0.22em] uppercase text-brass sm:text-[0.6rem]">{watch.brand}</span>
        <span className="block truncate font-display text-xs leading-tight text-ivory sm:text-base">{watch.model}</span>
        <span className="mt-0.5 hidden text-[0.65rem] text-stone sm:block">{formatPrice(watch, lang)}</span>
      </span>
    </Link>
  );
}
