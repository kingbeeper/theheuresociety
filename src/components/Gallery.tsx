"use client";

import Image from "next/image";
import { useState } from "react";
import { Monogram } from "./Monogram";

export function Gallery({ images, alt, photoLabel }: { images: string[]; alt: string; photoLabel: string }) {
  const [active, setActive] = useState(0);

  return (
    <div className="lg:sticky lg:top-8">
      <div className="relative aspect-[4/5] overflow-hidden bg-[radial-gradient(ellipse_at_center,var(--color-emerald)_0%,var(--color-moss)_55%,var(--color-forest)_100%)]">
        {images.length > 0 ? (
          <Image
            key={images[active]}
            src={images[active]}
            alt={alt}
            fill
            priority
            sizes="(min-width: 1024px) 50vw, 100vw"
            className="object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center opacity-25">
            <Monogram size={110} />
          </div>
        )}
      </div>

      {images.length > 1 && (
        <div className="mt-4 flex gap-3">
          {images.map((src, i) => (
            <button
              key={src}
              type="button"
              onClick={() => setActive(i)}
              aria-label={`${photoLabel} ${i + 1}`}
              aria-current={i === active}
              className={`relative aspect-[4/5] w-20 overflow-hidden border transition-colors ${
                i === active ? "border-brass" : "border-line opacity-60 hover:opacity-100"
              }`}
            >
              <Image src={src} alt="" fill sizes="80px" className="object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
