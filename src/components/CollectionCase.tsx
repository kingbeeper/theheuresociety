"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import cutouts from "@/data/cutouts.json";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/app/[lang]/dictionaries";
import { formatPrice, type Watch } from "@/lib/watches";
import { packIntoCases, type Slot } from "@/lib/cases";

const CUTOUTS = cutouts as Record<string, string>;

// Qué relojes van en el estuche: los que tienen recorte y no están vendidos.
// Al marcar uno como vendido (p. ej. /vendido en Telegram) sale solo y el estuche se reajusta.
export const inCase = (w: Watch) => w.status !== "sold" && Boolean(CUTOUTS[w.slug]);

// Los recortes son 600×1200 con la caja del reloj ocupando el 62 % del ancho.
// Con este ancho (respecto al cojín) la caja del reloj ocupa ~85 % del cojín,
// dejando ver más brazalete por arriba y por abajo.
const CUTOUT_WIDTH = 137; // % del ancho del cojín

// Como en el estuche real: la caja del reloj descansa en la parte alta del cojín,
// el brazalete apenas asoma por arriba (se va por detrás) y baja por delante.
const HEAD_AT = 46; // centro de la caja del reloj, en % del alto del cojín
const TOP_REACH = 8; // cuánto asoma el brazalete por encima del cojín, en % de su alto

export function CollectionCase({ watches, lang, dict }: { watches: Watch[]; lang: Locale; dict: Dictionary }) {
  const cases = packIntoCases(watches.filter(inCase));
  // Reloj seleccionado: muestra su rótulo; un segundo clic abre la ficha
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !(e.target as Element).closest("[data-case-slot]"))
        setSelected(null);
    };
    document.addEventListener("click", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", close);
    };
  }, []);

  if (!cases.length) {
    return <p className="py-16 text-center text-sm text-stone">{dict.catalog.caseEmpty}</p>;
  }

  return (
    <div className="space-y-6">
      {cases.map(({ layout, items }, i) => (
        // El estuche se presenta entero sobre la "mesa": centrado, con aire y un halo de luz
        <div
          key={`${layout.id}-${i}`}
          className="bg-[radial-gradient(ellipse_60%_55%_at_50%_50%,rgba(31,58,45,0.55),transparent_75%)] px-2 py-12 sm:px-8 sm:py-16"
        >
        <div
          className="relative mx-auto w-full overflow-hidden rounded-[6px] shadow-[0_45px_70px_-25px_rgba(0,0,0,0.95),0_0_0_1px_rgba(0,0,0,0.4)]"
          style={{ aspectRatio: `${layout.width} / ${layout.height}`, maxWidth: layout.maxWidth }}
        >
          <Image
            src={layout.image}
            alt=""
            fill
            priority={i === 0}
            sizes={`(min-width: ${layout.maxWidth}px) ${layout.maxWidth}px, 100vw`}
            className="object-cover"
          />
          {items.map((watch, s) => (
            <CaseSlot
              key={watch.slug}
              watch={watch}
              slot={layout.slots[s]}
              reach={layout.reach}
              selected={selected === watch.slug}
              onSelect={() => setSelected(watch.slug)}
              lang={lang}
              dict={dict}
            />
          ))}
        </div>
        </div>
      ))}
      <p className="text-center text-[0.68rem] tracking-[0.22em] uppercase text-stone/70">{dict.catalog.caseHint}</p>
    </div>
  );
}

function CaseSlot({
  watch,
  slot,
  reach,
  selected,
  onSelect,
  lang,
  dict,
}: {
  watch: Watch;
  slot: Slot;
  reach: number;
  selected: boolean;
  onSelect: () => void;
  lang: Locale;
  dict: Dictionary;
}) {
  const cutout = CUTOUTS[watch.slug]!;
  const name = `${watch.brand} ${watch.model}`;

  return (
    <Link
      href={`/${lang}/watches/${watch.slug}`}
      aria-label={`${name}, ${formatPrice(watch, lang)}`}
      data-case-slot
      onClick={(e) => {
        // Primer clic: mostrar el rótulo. Con el rótulo abierto, el clic abre la ficha.
        if (!selected) {
          e.preventDefault();
          onSelect();
        }
      }}
      className="group absolute focus-visible:outline-none"
      style={{ left: `${slot.x}%`, top: `${slot.y}%`, width: `${slot.w}%`, height: `${slot.h}%` }}
    >
      {/* Zona visible del reloj: desde un poco por encima del cojín hasta el hueco bajo
          su borde frontal (`reach`). El brazalete es nítido sobre todo el cojín y solo
          se difumina fuera de él, donde se mete por detrás o en el compartimento. */}
      <span
          className="absolute -left-1/4 -right-1/4"
          style={{
            top: `-${TOP_REACH}%`,
            bottom: `-${reach}%`,
            maskImage: braceletMask(reach),
            WebkitMaskImage: braceletMask(reach),
          }}
        >
          <Image
            src={cutout}
            alt=""
            width={600}
            height={1200}
            sizes="(min-width: 1152px) 260px, 22vw"
            className={`absolute left-1/2 h-auto max-w-none -translate-x-1/2 -translate-y-1/2 drop-shadow-[0_14px_14px_rgba(0,0,0,0.65)] transition duration-500 group-hover:-translate-y-[51.5%] group-hover:brightness-110 group-focus-visible:brightness-110 ${selected ? "-translate-y-[51.5%] brightness-110" : ""}`}
            style={{
              width: `${(CUTOUT_WIDTH / 150) * 100}%`,
              top: `${((HEAD_AT + TOP_REACH) / (100 + TOP_REACH + reach)) * 100}%`,
            }}
          />
        </span>

      {watch.status !== "available" && (
        <span className="absolute left-1/2 top-[6%] -translate-x-1/2 whitespace-nowrap bg-ink/85 px-2 py-1 text-[0.5rem] tracking-[0.2em] uppercase text-brass sm:text-[0.6rem]">
          {dict.watch[watch.status]}
        </span>
      )}

      {/* Rótulo: solo aparece al hacer clic en el reloj (o al llegar con el teclado) */}
      <span
        className={`absolute inset-x-[-12%] bottom-[3%] z-10 bg-ink/90 px-2 py-2 text-center backdrop-blur-sm transition duration-300 group-focus-visible:translate-y-0 group-focus-visible:opacity-100 ${
          selected ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-1 opacity-0"
        }`}
      >
        <span className="block text-[0.5rem] tracking-[0.22em] uppercase text-brass sm:text-[0.6rem]">{watch.brand}</span>
        <span className="block truncate font-display text-xs leading-tight text-ivory sm:text-base">{watch.model}</span>
        <span className="mt-0.5 hidden text-[0.65rem] text-stone sm:block">{formatPrice(watch, lang)}</span>
        <span className="mt-1 block text-[0.5rem] tracking-[0.2em] uppercase text-brass sm:text-[0.6rem]">{dict.catalog.viewPiece} →</span>
      </span>
    </Link>
  );
}

// Difuminado solo fuera del cojín: por encima (TOP_REACH) y por debajo (reach)
function braceletMask(reach: number) {
  const total = 100 + TOP_REACH + reach;
  const top = (TOP_REACH / total) * 100;
  const bottom = 100 - (reach / total) * 100;
  return `linear-gradient(to bottom, transparent 0%, black ${top}%, black ${bottom}%, transparent 100%)`;
}
