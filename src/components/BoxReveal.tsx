"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

// Posición de la caja dentro de collection-trio-tall.jpg (1740 × 1550), en %
const LID = { left: 3.22, top: 29.68, width: 95.98, height: 60.26 };
// Ángulo final de la tapa: algo más de 90° para que quede apoyada hacia atrás
const OPEN_ANGLE = 108;

export function BoxReveal({
  alt,
  openLabel,
  closeLabel,
}: {
  alt: string;
  openLabel: string;
  closeLabel: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  // Se abre sola la primera vez que la caja entra en pantalla
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let timer: ReturnType<typeof setTimeout>;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          timer = setTimeout(() => setOpen(true), reduced ? 0 : 700);
          io.disconnect();
        }
      },
      // Se dispara cuando la caja cruza el centro de la pantalla
      { rootMargin: "-45% 0px -45% 0px" }
    );
    io.observe(el);
    return () => {
      io.disconnect();
      clearTimeout(timer);
    };
  }, []);

  return (
    <div>
      <div
        ref={ref}
        className="relative aspect-[1740/1550] overflow-hidden shadow-[0_40px_80px_-20px_rgba(0,0,0,0.8)]"
        style={{ perspective: "4200px", perspectiveOrigin: "50% 55%" }}
      >
        <Image
          src="/watches/collection-trio-tall.jpg"
          alt={alt}
          fill
          priority
          sizes="(min-width: 1152px) 1152px, 100vw"
          className="object-cover"
        />

        {/* Penumbra del interior mientras la tapa está cerrada o abriéndose */}
        <div
          className="pointer-events-none absolute bg-black transition-opacity duration-[1600ms] ease-out"
          style={{
            left: `${LID.left}%`, top: `${LID.top}%`, width: `${LID.width}%`, height: `${LID.height}%`,
            opacity: open ? 0 : 0.85,
          }}
        />

        {/* Tapa: bisagra en el borde superior */}
        <div
          aria-hidden
          className="absolute [transform-style:preserve-3d]"
          style={{
            left: `${LID.left}%`, top: `${LID.top}%`, width: `${LID.width}%`, height: `${LID.height}%`,
            transformOrigin: "50% 0%",
            transform: open ? `rotateX(${OPEN_ANGLE}deg)` : "rotateX(0deg)",
            transition: open
              ? "transform 2.4s cubic-bezier(0.55, 0, 0.15, 1)"
              : "transform 1.6s cubic-bezier(0.6, 0, 0.2, 1)",
          }}
        >
          {/* Exterior: cuero negro con el monograma en latón */}
          <div className="absolute inset-0 overflow-hidden rounded-[3px] shadow-[0_18px_40px_rgba(0,0,0,0.65)] [backface-visibility:hidden]">
            <Image src="/brand/box-lid-outer.jpg" alt="" fill sizes="1152px" className="object-cover" />
            <div className="absolute inset-0 flex items-center justify-center">
              <div
                className="h-[44%] aspect-[435/559] drop-shadow-[0_1px_0_rgba(255,255,255,0.18)]"
                style={{
                  background:
                    "linear-gradient(135deg, #f3e2b0 0%, #c8a960 30%, #8f7136 55%, #d9bf7d 75%, #9c7c3c 100%)",
                  WebkitMaskImage: "url(/brand/monogram-white.png)",
                  maskImage: "url(/brand/monogram-white.png)",
                  WebkitMaskSize: "contain",
                  maskSize: "contain",
                  WebkitMaskRepeat: "no-repeat",
                  maskRepeat: "no-repeat",
                  WebkitMaskPosition: "center",
                  maskPosition: "center",
                  filter: "drop-shadow(0 -1px 0 rgba(0,0,0,0.6))",
                }}
              />
            </div>
          </div>

          {/* Interior de la tapa: mismo marco, latón y terciopelo que la base */}
          <div className="absolute inset-0 overflow-hidden rounded-[3px] [backface-visibility:hidden] [transform:rotateX(180deg)]">
            <Image src="/brand/box-lid-inner.jpg" alt="" fill sizes="1152px" className="object-cover" />
          </div>
        </div>
      </div>

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="text-[0.66rem] tracking-[0.24em] uppercase text-stone transition-colors hover:text-brass"
        >
          {open ? closeLabel : openLabel}
        </button>
      </div>
    </div>
  );
}
