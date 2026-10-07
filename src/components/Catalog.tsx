"use client";

import { useMemo, useState } from "react";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/app/[lang]/dictionaries";
import type { Watch } from "@/lib/watches";
import { WatchCard } from "./WatchCard";
import { CollectionCase, inCase } from "./CollectionCase";

type Sort = "new" | "priceAsc" | "priceDesc";

export function Catalog({
  watches,
  brands,
  lang,
  dict,
}: {
  watches: Watch[];
  brands: string[];
  lang: Locale;
  dict: Dictionary;
}) {
  const t = dict.catalog;
  const [brand, setBrand] = useState<string | null>(null);
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [sort, setSort] = useState<Sort>("new");
  const [view, setView] = useState<"case" | "grid">("case");

  const list = useMemo(() => {
    const filtered = watches.filter(
      (w) => (!brand || w.brand === brand) && (!onlyAvailable || w.status === "available")
    );
    if (sort === "new") return filtered;
    // Sin precio ("a consultar") siempre al final
    const price = (w: Watch) => w.price ?? (sort === "priceAsc" ? Infinity : -Infinity);
    return [...filtered].sort((a, b) =>
      sort === "priceAsc" ? price(a) - price(b) : price(b) - price(a)
    );
  }, [watches, brand, onlyAvailable, sort]);

  const chip = (active: boolean) =>
    `whitespace-nowrap border px-4 py-2 text-[0.68rem] tracking-[0.2em] uppercase transition-colors ${
      active
        ? "border-brass bg-brass text-ink"
        : "border-line text-stone hover:border-ivory/40 hover:text-ivory"
    }`;

  return (
    <>
      {/* Filtros */}
      <div className="sticky top-0 z-20 -mx-5 border-b border-line bg-ink/90 px-5 py-4 backdrop-blur md:-mx-10 md:px-10">
        <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-4">
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1" role="group" aria-label={t.brand}>
            <button type="button" className={chip(brand === null)} onClick={() => setBrand(null)}>
              {t.all}
            </button>
            {brands.map((b) => (
              <button key={b} type="button" className={chip(brand === b)} onClick={() => setBrand(b)}>
                {b}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-6">
            <label className="flex cursor-pointer items-center gap-2 text-[0.7rem] tracking-[0.16em] uppercase text-stone">
              <input
                type="checkbox"
                checked={onlyAvailable}
                onChange={(e) => setOnlyAvailable(e.target.checked)}
                className="h-3.5 w-3.5 accent-[var(--color-brass)]"
              />
              {t.onlyAvailable}
            </label>
            <label className="flex items-center gap-2 text-[0.7rem] tracking-[0.16em] uppercase text-stone">
              <span className="sr-only sm:not-sr-only">{t.sort}</span>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as Sort)}
                className="border border-line bg-ink px-3 py-2 text-[0.7rem] tracking-[0.1em] text-ivory"
              >
                <option value="new">{t.sortNew}</option>
                <option value="priceAsc">{t.sortPriceAsc}</option>
                <option value="priceDesc">{t.sortPriceDesc}</option>
              </select>
            </label>
          </div>
        </div>
      </div>

      <div className="mt-8 flex items-center justify-between gap-4">
        <p className="text-xs tracking-[0.18em] uppercase text-stone">
          {(() => {
            // El contador refleja lo que se ve: en el estuche, solo las piezas que contiene
            const n = view === "case" ? list.filter(inCase).length : list.length;
            return n === 1 ? t.countOne : t.count.replace("{n}", String(n));
          })()}
        </p>
        <div className="flex border border-line" role="group" aria-label={t.view}>
          {(["case", "grid"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={`px-4 py-2 text-[0.66rem] tracking-[0.2em] uppercase transition-colors ${
                view === v ? "bg-moss text-ivory" : "text-stone hover:text-ivory"
              }`}
            >
              {v === "case" ? t.viewCase : t.viewGrid}
            </button>
          ))}
        </div>
      </div>

      {list.length > 0 ? (
        view === "case" ? (
          <div className="mt-10">
            <CollectionCase watches={list} lang={lang} dict={dict} />
          </div>
        ) : (
          <div className="mt-8 grid gap-x-8 gap-y-14 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((w) => (
              <WatchCard key={w.slug} watch={w} lang={lang} dict={dict} />
            ))}
          </div>
        )
      ) : (
        <div className="py-24 text-center">
          <p className="font-display text-2xl text-stone">{t.empty}</p>
          <button
            type="button"
            onClick={() => {
              setBrand(null);
              setOnlyAvailable(false);
            }}
            className="mt-6 border-b border-brass/60 pb-1 text-[0.7rem] tracking-[0.22em] uppercase text-ivory"
          >
            {t.reset}
          </button>
        </div>
      )}
    </>
  );
}
