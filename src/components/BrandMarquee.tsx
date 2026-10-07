const BRANDS = ["Rolex", "Audemars Piguet", "Patek Philippe", "Richard Mille", "Cartier", "Vacheron Constantin", "Omega"];

// Una tira de nombres que se desplaza sin fin. La lista va duplicada para que el bucle no tenga saltos.
export function BrandMarquee({ label }: { label: string }) {
  const row = (hidden: boolean) => (
    <ul aria-hidden={hidden || undefined} className="flex shrink-0 items-center">
      {BRANDS.map((b) => (
        <li key={b} className="flex items-center">
          <span className="px-8 font-display text-3xl font-light italic text-ivory/80 md:px-12 md:text-4xl">{b}</span>
          <span className="h-1.5 w-1.5 rotate-45 bg-brass/70" />
        </li>
      ))}
    </ul>
  );

  return (
    <section aria-label={label} className="group relative overflow-hidden border-y border-line py-9 md:py-11">
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-24 bg-gradient-to-r from-ink to-transparent md:w-48" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-24 bg-gradient-to-l from-ink to-transparent md:w-48" />
      <div className="marquee flex w-max group-hover:[animation-play-state:paused]">
        {row(false)}
        {row(true)}
      </div>
    </section>
  );
}
