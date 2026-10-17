import { Suspense } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { dealerItems, validPricelist } from "@/lib/pricelist";
import { contact } from "@/lib/site";
import { PrintButton } from "../../d/[token]/PrintButton";

// Lista de precios para el gremio: stock disponible a precio de dealer (sin costos ni seriales)
export default function Page({ params }: PageProps<"/p/[token]">) {
  return (
    <Suspense fallback={<main className="min-h-screen" />}>
      <PriceList params={params} />
    </Suspense>
  );
}

async function PriceList({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  if (!/^[\w-]{20,40}$/.test(token) || !(await validPricelist(token))) notFound();
  const items = await dealerItems();
  const today = new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "America/New_York" }).format(new Date());
  const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

  return (
    <main className="mx-auto max-w-4xl px-5 py-10 sm:py-14">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-[#d8d2c4] pb-6">
        <div>
          <p className="text-[0.62rem] tracking-[0.32em] uppercase text-[#8a7a52]">The Heure Society · Miami</p>
          <h1 className="mt-3 font-display text-4xl font-light">Dealer price list</h1>
          <p className="mt-2 text-sm text-[#4a4f4b]">For the trade only · {today} · {items.length} pieces · subject to prior sale</p>
        </div>
        <span className="print:hidden"><PrintButton label="Print / Save as PDF" /></span>
      </header>

      {items.length ? (
        <ul className="divide-y divide-[#d8d2c4] border-y border-[#d8d2c4]">
          {items.map((i) => (
            <li key={i.id} className="flex items-center gap-4 py-3 break-inside-avoid">
              {i.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={i.image} alt="" className="h-16 w-16 shrink-0 object-cover" />
              ) : (
                <span className="h-16 w-16 shrink-0 bg-[#e2ded4]" />
              )}
              <div className="min-w-0 flex-1">
                <p className="font-display text-lg leading-tight">{i.title}</p>
                <p className="text-xs text-[#5d625e]">{[i.year, i.condition, i.set].filter(Boolean).join(" · ")}</p>
              </div>
              <div className="text-right">
                <p className="font-display text-xl tabular-nums">{usd(i.price)}</p>
                {i.slug && <a href={`/en/watches/${i.slug}`} className="text-[0.6rem] tracking-[0.16em] uppercase text-[#8a7a52] print:hidden">Photos →</a>}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-[#5d625e]">No pieces available right now.</p>
      )}

      <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 text-xs text-[#4a4f4b]">
        <p>Prices in USD, before tax. Wire or Zelle. Pieces authenticated and sold as described.</p>
        <a href={`https://wa.me/${contact.whatsapp}?text=${encodeURIComponent("Hi, I'm interested in a piece from your dealer price list.")}`} className="bg-[#1b1f1c] px-5 py-3 text-[0.66rem] tracking-[0.22em] uppercase text-[#f4f1ea] print:hidden">WhatsApp {contact.phoneDisplay}</a>
      </footer>
    </main>
  );
}
