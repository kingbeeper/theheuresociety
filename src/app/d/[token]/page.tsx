import { Suspense } from "react";
import Image from "next/image";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { adminDb } from "@/lib/supabase";
import { getDocSettings } from "@/lib/documents";
import { PRINT, docTotals, usd, type Doc } from "@/lib/doc-labels";
import { PrintButton } from "./PrintButton";

// Lo que ve el cliente: solo los datos del documento (nunca costos, proveedores ni notas internas)
export default function Page({ params }: PageProps<"/d/[token]">) {
  return (
    <Suspense fallback={<main className="min-h-screen" />}>
      <SharedDocument params={params} />
    </Suspense>
  );
}

async function SharedDocument({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  if (!/^[\w-]{20,40}$/.test(token)) notFound();
  const { data } = await adminDb().from("documents").select("*").eq("token", token).maybeSingle();
  const d = data as Doc | null;
  if (!d || d.status === "draft") notFound();
  const s = await getDocSettings();
  const t = PRINT[d.lang];
  const totals = docTotals(d);
  const date = (iso: string | null) =>
    iso ? new Intl.DateTimeFormat(d.lang === "es" ? "es-ES" : "en-US", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`)) : "—";
  const consign = d.kind === "consignment";
  const stamp = d.status === "void" ? t.void : d.status === "paid" && !consign ? t.paid : null;

  return (
    <main className="mx-auto max-w-[860px] px-4 py-8 print:max-w-none print:p-0">
      <div className="mb-4 flex justify-end print:hidden">
        <div className="flex gap-2">
          <a href={`/d/${d.token}/pdf`} download className="border border-[#1b1f1c] px-5 py-2.5 text-[0.68rem] tracking-[0.22em] uppercase hover:bg-[#1b1f1c] hover:text-white">PDF</a>
          <PrintButton label={t.print} />
        </div>
      </div>

      <article className="relative bg-white px-6 py-10 shadow-sm sm:px-12 print:px-0 print:py-0 print:shadow-none">
        {stamp && (
          <p className="pointer-events-none absolute top-24 right-10 rotate-[-12deg] border-4 border-current px-5 py-1 font-display text-4xl tracking-[0.2em] text-emerald-800/70">
            {stamp}
          </p>
        )}

        <header className="flex flex-wrap items-start justify-between gap-6 border-b border-[#d8d2c4] pb-8">
          <div className="flex items-center gap-4">
            <Image src="/brand/monogram-dark.png" alt="" width={44} height={57} priority />
            <div>
              <p className="font-display text-2xl tracking-[0.18em] uppercase">{s.doc_company}</p>
              <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-[#5d625e]">
                {s.doc_address}
                {"\n"}
                {[s.doc_phone, s.doc_email].filter(Boolean).join(" · ")}
                {s.doc_tax_id ? `\nEIN ${s.doc_tax_id}` : ""}
              </p>
            </div>
          </div>
          <div className="text-right">
            <h1 className={`font-display font-light tracking-[0.06em] ${consign ? "text-[1.7rem] leading-tight" : "text-4xl"}`}>{t[d.kind]}</h1>
            <dl className="mt-3 grid grid-cols-[auto_auto] justify-end gap-x-4 gap-y-1 text-xs">
              <dt className="text-[#5d625e]">{t.number}</dt><dd>{d.number}</dd>
              <dt className="text-[#5d625e]">{t.date}</dt><dd>{date(d.issue_date)}</dd>
              {d.due_date && (<><dt className="text-[#5d625e]">{t.due[d.kind]}</dt><dd>{date(d.due_date)}</dd></>)}
            </dl>
          </div>
        </header>

        <section className="py-7">
          <p className="text-[0.62rem] tracking-[0.24em] uppercase text-[#8a7a52]">{t.billTo[d.kind]}</p>
          <p className="mt-2 font-display text-xl">{d.client_name}</p>
          <p className="whitespace-pre-line text-sm text-[#5d625e]">
            {[d.client_company, d.client_address, [d.client_phone, d.client_email].filter(Boolean).join(" · ")].filter(Boolean).join("\n")}
          </p>
        </section>

        <table className="w-full text-sm">
          <thead>
            <tr className="border-y border-[#d8d2c4] text-left text-[0.6rem] tracking-[0.2em] uppercase text-[#5d625e]">
              <th className="py-3 font-normal">{t.item}</th>
              <th className="py-3 text-center font-normal">{t.qty}</th>
              <th className="py-3 text-right font-normal">{t.price}</th>
              <th className="py-3 text-right font-normal">{consign ? t.net : t.amount}</th>
            </tr>
          </thead>
          <tbody>
            {d.items.map((l, i) => (
              <tr key={i} className="border-b border-[#ece7dc] align-top">
                <td className="py-4 pr-4">
                  <p className="font-display text-lg leading-tight">{l.title}</p>
                  {l.details && <p className="mt-1 text-xs text-[#5d625e]">{l.details}</p>}
                  {d.show_serial && l.serial && <p className="mt-1 text-xs text-[#5d625e]">{t.serial}: {l.serial}</p>}
                </td>
                <td className="py-4 text-center tabular-nums">{l.qty}</td>
                <td className="py-4 text-right tabular-nums">{usd(l.price)}</td>
                <td className="py-4 text-right tabular-nums">{usd(l.qty * l.price)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-6 flex justify-end">
          <dl className="grid w-full max-w-[300px] grid-cols-[1fr_auto] gap-y-2 text-sm">
            <dt className="text-[#5d625e]">{t.subtotal}</dt><dd className="text-right tabular-nums">{usd(totals.subtotal)}</dd>
            {totals.discount > 0 && (<><dt className="text-[#5d625e]">{t.discount}</dt><dd className="text-right tabular-nums">−{usd(totals.discount)}</dd></>)}
            {totals.tax > 0 && (<><dt className="text-[#5d625e]">{t.tax} ({Number(d.tax_rate)}%)</dt><dd className="text-right tabular-nums">{usd(totals.tax)}</dd></>)}
            {totals.shipping > 0 && (<><dt className="text-[#5d625e]">{t.shipping}</dt><dd className="text-right tabular-nums">{usd(totals.shipping)}</dd></>)}
            <dt className="mt-2 border-t border-[#1b1f1c] pt-3 font-display text-xl">{consign ? t.netTotal : t.total}</dt>
            <dd className="mt-2 border-t border-[#1b1f1c] pt-3 text-right font-display text-xl tabular-nums">{usd(totals.total)}</dd>
          </dl>
        </div>

        <footer className="mt-10 grid gap-6 border-t border-[#d8d2c4] pt-6 text-xs leading-relaxed text-[#4a4f4b]">
          {d.notes && (
            <div><p className="mb-1 text-[0.6rem] tracking-[0.2em] uppercase text-[#8a7a52]">{t.notes}</p><p className="whitespace-pre-line">{d.notes}</p></div>
          )}
          {d.kind !== "memo" && !consign && (d.payment_method || s.doc_payment_info) && (
            <div>
              <p className="mb-1 text-[0.6rem] tracking-[0.2em] uppercase text-[#8a7a52]">{t.payment}</p>
              <p className="whitespace-pre-line">{[d.payment_method, d.status === "paid" ? null : s.doc_payment_info].filter(Boolean).join("\n")}</p>
            </div>
          )}
          {d.terms && (
            <div><p className="mb-1 text-[0.6rem] tracking-[0.2em] uppercase text-[#8a7a52]">{t.terms}</p><p className="whitespace-pre-line">{d.terms}</p></div>
          )}
          {d.kind === "memo" && (
            <div className="mt-8 grid gap-10 sm:grid-cols-2">
              <p className="border-t border-[#1b1f1c] pt-2">{t.signature}</p>
              <p className="border-t border-[#1b1f1c] pt-2">{t.date}</p>
            </div>
          )}
          {consign && (
            <div className="mt-8 grid gap-10 sm:grid-cols-2">
              {t.consignSign.map((who) => (
                <div key={who}>
                  <p className="border-t border-[#1b1f1c] pt-2">{who}</p>
                  <p className="mt-6 border-t border-[#1b1f1c] pt-2">{t.date}</p>
                </div>
              ))}
            </div>
          )}
        </footer>
      </article>
    </main>
  );
}
