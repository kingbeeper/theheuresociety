"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import cutouts from "@/data/cutouts.json";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/app/[lang]/dictionaries";
import { formatPrice, type Watch } from "@/lib/watches";
import { packIntoCases, type CaseLayout, type Slot } from "@/lib/cases";
import { GoldMonogram } from "./GoldMonogram";

const CUTOUTS = cutouts as Record<string, string>;

// Recorte del reloj: el que genera el robot al publicar o, si no, uno hecho a mano
const cutoutOf = (w: Watch) => w.cutout ?? CUTOUTS[w.slug];

// Qué relojes van en el estuche: los que tienen recorte y no están vendidos.
// Al marcar uno como vendido (p. ej. /vendido en Telegram) sale solo y el estuche se reajusta.
export const inCase = (w: Watch) => w.status !== "sold" && Boolean(cutoutOf(w));

// Los recortes son 600×1200 con la caja del reloj ocupando el 62 % del ancho.
// Con este ancho (respecto al cojín) la caja del reloj ocupa ~85 % del cojín,
// dejando ver más brazalete por arriba y por abajo.
const CUTOUT_WIDTH = 137; // % del ancho del cojín

// Como en el estuche real: la caja del reloj descansa en la parte alta del cojín,
// el brazalete apenas asoma por arriba (se va por detrás) y baja por delante.
const HEAD_AT = 46; // centro de la caja del reloj, en % del alto del cojín
const TOP_REACH = 8; // cuánto asoma el brazalete por encima del cojín, en % de su alto

// Interacción según cómo se usa, no según el dispositivo (hay portátiles táctiles):
// - con ratón: pasar el cursor muestra el rótulo sobre el reloj; un clic abre la ficha
// - con el dedo: tocar un reloj lo destaca y muestra una tarjeta bajo el estuche;
//   tocarlo otra vez (o el botón de la tarjeta) abre la ficha
export function CollectionCase({
  watches,
  lang,
  dict,
  withLid = false,
}: {
  watches: Watch[];
  lang: Locale;
  dict: Dictionary;
  // Portada: un solo estuche con tapa, que se abre al llegar a él
  withLid?: boolean;
}) {
  const shown = watches.filter(inCase);
  const packed = packIntoCases(shown);
  const cases = withLid ? packed.slice(0, 1) : packed;
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

  // Tocar fuera del estuche o pulsar Escape quita la selección
  useEffect(() => {
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !root.current?.contains(e.target as Node)) setSelected(null);
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

  const picked = shown.find((w) => w.slug === selected);

  return (
    <div ref={root}>
      {cases.map(({ layout, items }, i) => (
        // El estuche se presenta entero sobre la "mesa": centrado, con aire y un halo de luz
        <div
          key={`${layout.id}-${i}`}
          className="bg-[radial-gradient(ellipse_60%_55%_at_50%_50%,rgba(31,58,45,0.55),transparent_75%)] px-2 py-12 sm:px-8 sm:py-16"
        >
          <CaseFrame layout={layout} withLid={withLid} lang={lang} dict={dict}>
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
                hovered={hovered === watch.slug}
                selected={selected === watch.slug}
                onHover={(on) => setHovered(on ? watch.slug : null)}
                onSelect={() => setSelected(watch.slug)}
                lang={lang}
                dict={dict}
              />
            ))}
          </div>
          </CaseFrame>
        </div>
      ))}

      {/* Tarjeta para pantallas táctiles: detalles del reloj tocado, fuera del estuche */}
      <div aria-live="polite" className="mx-auto mt-2 min-h-24 max-w-md px-4 text-center">
        {picked ? (
          <div className="border border-line bg-forest/80 px-6 py-5 backdrop-blur">
            <p className="text-[0.62rem] tracking-[0.26em] uppercase text-brass">{picked.brand}</p>
            <p className="mt-1 font-display text-2xl leading-tight">{picked.model}</p>
            <p className="mt-1 text-xs text-stone">
              Ref. {picked.reference} · {formatPrice(picked, lang)}
            </p>
            <Link
              href={`/${lang}/watches/${picked.slug}`}
              className="mt-4 inline-block border border-brass/60 px-6 py-2.5 text-[0.66rem] tracking-[0.22em] uppercase text-ivory transition-colors hover:bg-brass hover:text-ink"
            >
              {dict.catalog.viewPiece} →
            </Link>
          </div>
        ) : (
          <p className="pt-3 text-[0.68rem] tracking-[0.22em] uppercase text-stone/70">{dict.catalog.caseHint}</p>
        )}
      </div>
    </div>
  );
}

function CaseSlot({
  watch,
  slot,
  reach,
  hovered,
  selected,
  onHover,
  onSelect,
  lang,
  dict,
}: {
  watch: Watch;
  slot: Slot;
  reach: number;
  hovered: boolean;
  selected: boolean;
  onHover: (on: boolean) => void;
  onSelect: () => void;
  lang: Locale;
  dict: Dictionary;
}) {
  const cutout = cutoutOf(watch)!;
  const name = `${watch.brand} ${watch.model}`;
  const pointer = useRef<string>("mouse");
  const raised = hovered || selected;

  return (
    <Link
      href={`/${lang}/watches/${watch.slug}`}
      aria-label={`${name}, ${formatPrice(watch, lang)}`}
      onPointerDown={(e) => (pointer.current = e.pointerType)}
      onPointerEnter={(e) => e.pointerType === "mouse" && onHover(true)}
      onPointerLeave={(e) => e.pointerType === "mouse" && onHover(false)}
      onClick={(e) => {
        // Con el dedo, el primer toque solo selecciona; con ratón o teclado, abre la ficha
        if (pointer.current !== "mouse" && !selected) {
          e.preventDefault();
          onSelect();
        }
        pointer.current = "mouse";
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
          className={`absolute left-1/2 h-auto max-w-none -translate-x-1/2 drop-shadow-[0_14px_14px_rgba(0,0,0,0.65)] transition duration-500 group-focus-visible:brightness-110 ${
            raised ? "-translate-y-[51.5%] brightness-110" : "-translate-y-1/2"
          }`}
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

      {/* Rótulo sobre el reloj: solo al pasar el ratón (o al llegar con el teclado) */}
      <span
        className={`pointer-events-none absolute inset-x-[-12%] bottom-[3%] z-10 bg-ink/90 px-2 py-2 text-center backdrop-blur-sm transition duration-300 group-focus-visible:translate-y-0 group-focus-visible:opacity-100 ${
          hovered ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"
        }`}
      >
        <span className="block text-[0.5rem] tracking-[0.22em] uppercase text-brass sm:text-[0.6rem]">{watch.brand}</span>
        <span className="block truncate font-display text-xs leading-tight text-ivory sm:text-base">{watch.model}</span>
        <span className="mt-0.5 hidden text-[0.65rem] text-stone sm:block">{formatPrice(watch, lang)}</span>
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

// Envuelve la bandeja. Con `withLid`, añade la tapa del estuche: cerrada al principio,
// se abre (girando sobre la bisagra del fondo) cuando el estuche llega al centro de la pantalla.
const OPEN_ANGLE = 106;

function CaseFrame({
  layout,
  withLid,
  lang,
  dict,
  children,
}: {
  layout: CaseLayout;
  withLid: boolean;
  lang: Locale;
  dict: Dictionary;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!withLid || !ref.current) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let timer: ReturnType<typeof setTimeout>;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          timer = setTimeout(() => setOpen(true), reduced ? 0 : 500);
          io.disconnect();
        }
      },
      { rootMargin: "-40% 0px -40% 0px" }
    );
    io.observe(ref.current);
    return () => {
      io.disconnect();
      clearTimeout(timer);
    };
  }, [withLid]);

  if (!withLid) return <>{children}</>;

  const ratio = layout.height / layout.width;
  return (
    // Espacio arriba para la tapa abierta (padding en % del ancho = proporcional al estuche)
    <div style={{ paddingTop: `${ratio * 34}%` }}>
      <div
        ref={ref}
        className="relative mx-auto w-full"
        style={{ maxWidth: layout.maxWidth, perspective: "2600px", perspectiveOrigin: "50% 60%" }}
      >
        {children}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 [transform-style:preserve-3d]"
          style={{
            transformOrigin: "50% 0%",
            transform: open ? `rotateX(${OPEN_ANGLE}deg)` : "rotateX(0deg)",
            transition: "transform 2.4s cubic-bezier(0.55, 0, 0.15, 1)",
          }}
        >
          {/* Exterior: cuero de cocodrilo con el monograma dorado */}
          <div className="absolute inset-0 overflow-hidden rounded-[6px] shadow-[0_30px_50px_-20px_rgba(0,0,0,0.9)] [backface-visibility:hidden]">
            <Image src={`/cases/${layout.id}-lid-outer.jpg`} alt="" fill sizes={`${layout.maxWidth}px`} className="object-cover" />
            <div className="absolute inset-0 flex items-center justify-center">
              <GoldMonogram height={Math.round(layout.maxWidth * ratio * 0.28)} className="drop-shadow-[0_1px_1px_rgba(0,0,0,0.7)]" />
            </div>
          </div>
          {/* Interior: ante verde con el logo dorado, como el estuche real */}
          <div className="absolute inset-0 overflow-hidden rounded-[6px] [backface-visibility:hidden] [transform:rotateX(180deg)]">
            <Image src={`/cases/${layout.id}-lid-inner.jpg`} alt="" fill sizes={`${layout.maxWidth}px`} className="object-cover" />
            <div className="absolute inset-0 flex items-center justify-center">
              <Wordmark className="w-[46%]" />
            </div>
          </div>
        </div>
      </div>
      <p className="sr-only">{lang === "es" ? dict.box.open : dict.box.open}</p>
    </div>
  );
}

// Logo real "THE HEURE SOCIETY" (extraído de la foto de la tapa) pintado en latón
function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span
      className={`block ${className}`}
      style={{
        aspectRatio: "2448 / 459",
        background: "linear-gradient(135deg, #f3e2b0 0%, #c8a960 30%, #8f7136 55%, #d9bf7d 75%, #9c7c3c 100%)",
        WebkitMaskImage: "url(/brand/wordmark-white.png)",
        maskImage: "url(/brand/wordmark-white.png)",
        WebkitMaskSize: "contain",
        maskSize: "contain",
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        filter: "drop-shadow(0 1px 0 rgba(0,0,0,0.45))",
      }}
    />
  );
}
