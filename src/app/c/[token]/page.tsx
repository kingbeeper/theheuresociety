import { Suspense } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { portalData } from "@/lib/portal";
import { contact } from "@/lib/site";

// «Mi colección»: lo que el cliente nos compró (facturas y certificados), servicio recomendado, sus
// documentos, sus búsquedas, sus relojes en consignación y piezas que le pueden gustar.
export default function Page({ params }: PageProps<"/c/[token]">) {
  return (
    <Suspense fallback={<main className="min-h-screen" />}>
      <Portal params={params} />
    </Suspense>
  );
}

const T = {
  en: {
    title: "My collection", hello: "Hello", intro: "Your timepieces from The Heure Society, their documents, and what we're looking for on your behalf.",
    purchases: "Your timepieces", bought: "Purchased", invoice: "Invoice", certificate: "Certificate", service: "Recommended service", none: "No timepieces yet.",
    docs: "Your documents", consign: "Your timepieces with us", searches: "We're looking for", suggest: "You may also like", seeAll: "See the full collection",
    status: { in_stock: "For sale", reserved: "Reserved", sold: "Sold", returned: "Returned" } as Record<string, string>,
    docStatus: { sent: "Open", paid: "Paid", accepted: "Accepted", converted: "Completed", returned: "Closed", rejected: "Closed" } as Record<string, string>,
    kinds: { quote: "Quotation", memo: "Memorandum", invoice: "Invoice", consignment: "Consignment agreement", purchase: "Bill of sale", sourcing: "Sourcing agreement", proforma: "Invoice", return: "Return receipt", inspection: "Condition report" } as Record<string, string>,
    listing: "View listing", talk: "Message us on WhatsApp", book: "Book a private viewing", onRequest: "Price on request",
  },
  es: {
    title: "Mi colección", hello: "Hola", intro: "Sus relojes de The Heure Society, sus documentos y lo que estamos buscando para usted.",
    purchases: "Sus relojes", bought: "Comprado", invoice: "Factura", certificate: "Certificado", service: "Servicio recomendado", none: "Todavía no hay relojes.",
    docs: "Sus documentos", consign: "Sus relojes con nosotros", searches: "Estamos buscando para usted", suggest: "También le pueden gustar", seeAll: "Ver toda la colección",
    status: { in_stock: "En venta", reserved: "Reservado", sold: "Vendido", returned: "Devuelto" } as Record<string, string>,
    docStatus: { sent: "Abierto", paid: "Pagado", accepted: "Aceptado", converted: "Completado", returned: "Cerrado", rejected: "Cerrado" } as Record<string, string>,
    kinds: { quote: "Cotización", memo: "Memorándum", invoice: "Factura", consignment: "Contrato de consignación", purchase: "Contrato de compraventa", sourcing: "Acuerdo de búsqueda", proforma: "Factura", return: "Acta de devolución", inspection: "Ficha de inspección" } as Record<string, string>,
    listing: "Ver ficha", talk: "Escríbanos por WhatsApp", book: "Reservar una cita privada", onRequest: "Precio a consultar",
  },
};

async function Portal({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  if (!/^[\w-]{20,40}$/.test(token)) notFound();
  const p = await portalData(token);
  if (!p) notFound();
  const t = T[p.lang];
  const fmt = (iso: string | null) => (iso ? new Intl.DateTimeFormat(p.lang === "es" ? "es-ES" : "en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso.slice(0, 10)}T12:00:00Z`)) : "");
  const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
  const h2 = "mb-4 text-[0.62rem] tracking-[0.24em] uppercase text-[#8a7a52]";
  const card = "border border-[#d8d2c4] bg-[#f7f5f0] p-4";
  const link = "text-[0.62rem] tracking-[0.18em] uppercase text-[#8a7a52] underline-offset-4 hover:underline";

  return (
    <main className="mx-auto max-w-4xl px-5 py-10 sm:py-16">
      <header className="mb-10 border-b border-[#d8d2c4] pb-8">
        <p className="text-[0.62rem] tracking-[0.32em] uppercase text-[#8a7a52]">The Heure Society</p>
        <h1 className="mt-3 font-display text-4xl font-light">{t.title}</h1>
        <p className="mt-4 text-sm text-[#4a4f4b]">{p.name ? `${t.hello} ${p.name.split(" ")[0]}. ` : ""}{t.intro}</p>
      </header>

      <section className="mb-10">
        <h2 className={h2}>{t.purchases}</h2>
        {p.purchases.length ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {p.purchases.map((w) => (
              <article key={w.id} className={`${card} flex gap-4`}>
                {w.image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={w.image} alt="" className="h-24 w-24 shrink-0 object-cover" />
                )}
                <div className="min-w-0 text-sm">
                  <p className="font-display text-xl leading-tight">{w.title}</p>
                  {w.date && <p className="mt-1 text-xs text-[#5d625e]">{t.bought} · {fmt(w.date)}</p>}
                  {w.service && <p className="mt-1 text-xs text-[#5d625e]">{t.service}: {w.service}</p>}
                  <p className="mt-3 flex flex-wrap gap-4">
                    {w.invoice && <a href={w.invoice} className={link}>{t.invoice}</a>}
                    {w.certificate && <a href={w.certificate} className={link}>{t.certificate}</a>}
                  </p>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="text-sm text-[#5d625e]">{t.none}</p>
        )}
      </section>

      {p.consignments.length > 0 && (
        <section className="mb-10">
          <h2 className={h2}>{t.consign}</h2>
          <ul className="divide-y divide-[#d8d2c4] border-y border-[#d8d2c4] text-sm">
            {p.consignments.map((w) => (
              <li key={w.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <span>{w.title}</span>
                <span className="flex items-center gap-4">
                  <span className="text-xs text-[#5d625e]">{t.status[w.status] ?? w.status}</span>
                  {w.listing && <a href={`/${p.lang}/watches/${w.listing}`} className={link}>{t.listing}</a>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {p.openDocs.length > 0 && (
        <section className="mb-10">
          <h2 className={h2}>{t.docs}</h2>
          <ul className="divide-y divide-[#d8d2c4] border-y border-[#d8d2c4] text-sm">
            {p.openDocs.map((d) => (
              <li key={d.url} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <a href={d.url} className="hover:underline">{t.kinds[d.kind] ?? d.kind} {d.number}</a>
                <span className="text-xs text-[#5d625e]">{t.docStatus[d.status] ?? ""}{d.date ? ` · ${fmt(d.date)}` : ""}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {p.searches.length > 0 && (
        <section className="mb-10">
          <h2 className={h2}>{t.searches}</h2>
          <ul className="flex flex-wrap gap-2 text-sm">
            {p.searches.map((s) => <li key={s} className="border border-[#d8d2c4] px-3 py-1.5">{s}</li>)}
          </ul>
        </section>
      )}

      {p.suggestions.length > 0 && (
        <section className="mb-10">
          <h2 className={h2}>{t.suggest}</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {p.suggestions.map((w) => (
              <a key={w.slug} href={`/${p.lang}/watches/${w.slug}`} className="group">
                {w.images?.[0] && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={w.images[0]} alt="" className="aspect-square w-full object-cover" />
                )}
                <p className="mt-2 text-sm leading-tight group-hover:underline">{w.brand} {w.model}</p>
                <p className="text-xs text-[#5d625e]">{w.price ? usd(Number(w.price)) : t.onRequest}</p>
              </a>
            ))}
          </div>
          <a href={`/${p.lang}/watches`} className={`${link} mt-4 inline-block`}>{t.seeAll} →</a>
        </section>
      )}

      <footer className="flex flex-wrap gap-3 border-t border-[#d8d2c4] pt-8">
        <a href={`https://wa.me/${contact.whatsapp}`} className="bg-[#1b1f1c] px-5 py-3 text-[0.66rem] tracking-[0.22em] uppercase text-[#f4f1ea]">{t.talk}</a>
        <a href={`/${p.lang}/appointments`} className="border border-[#1b1f1c] px-5 py-3 text-[0.66rem] tracking-[0.22em] uppercase">{t.book}</a>
      </footer>
    </main>
  );
}
