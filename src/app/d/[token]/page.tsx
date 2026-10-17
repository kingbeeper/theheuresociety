import { Fragment, Suspense } from "react";
import Image from "next/image";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { adminDb } from "@/lib/supabase";
import { getDocSettings } from "@/lib/documents";
import { INSPECTION_PARTS, PART_LABEL, PRINT, SIGNABLE, STATE_LABEL, balanceDue, docTotals, maskedId, paidSoFar, usd, type Doc } from "@/lib/doc-labels";
import { PrintButton } from "./PrintButton";
import { SignaturePad } from "./SignaturePad";
import { downloadPrivate } from "@/lib/private-files";
import { stripeConfigured } from "@/lib/stripe";

// Lo que ve el cliente: solo los datos del documento (nunca costos, proveedores ni notas internas)
export default function Page({ params, searchParams }: PageProps<"/d/[token]">) {
  return (
    <Suspense fallback={<main className="min-h-screen" />}>
      <SharedDocument params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function SharedDocument({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
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
  const purchase = d.kind === "purchase";
  const sourcing = d.kind === "sourcing";
  const deposit = Number(d.deposit ?? 0);
  const receipt = d.kind === "return";
  // Ficha de inspección: sin precios; el estado del reloj, fotos y la firma de su dueño
  const insp = d.kind === "inspection" ? d.inspection ?? null : null;
  const noPrice = receipt || d.kind === "inspection";
  const svc = d.kind === "service" ? d.service ?? null : null;
  const twoParty = consign || purchase || sourcing || receipt || d.kind === "inspection" || d.kind === "service";
  const sellerId = purchase ? maskedId(d) : null;
  // Firma del cliente (imagen privada, se incrusta en la página)
  const sigBytes = d.signature_path ? await downloadPrivate(d.signature_path) : null;
  const signature = sigBytes ? `data:image/png;base64,${Buffer.from(sigBytes).toString("base64")}` : null;
  const signedOn = d.signed_at
    ? new Intl.DateTimeFormat(d.lang === "es" ? "es-ES" : "en-US", { dateStyle: "long", timeStyle: "short", timeZone: "America/New_York" }).format(new Date(d.signed_at))
    : null;
  const stamp = d.status === "void" ? t.void : d.status === "paid" && !consign ? t.paid : null;

  return (
    <main className="mx-auto max-w-[860px] px-4 py-8 print:max-w-none print:p-0">
      {(await searchParams).pagado && d.status !== "paid" && (
        <p className="mb-4 border border-emerald-700/30 bg-emerald-50 p-3 text-sm text-emerald-900 print:hidden">
          {d.lang === "es" ? "Pago recibido. En unos minutos la factura aparecerá como pagada." : "Payment received. The invoice will show as paid in a few minutes."}
        </p>
      )}
      {d.kind === "invoice" && d.status === "sent" && balanceDue(d) > 0 && stripeConfigured() && (
        <div className="mb-4 flex justify-end print:hidden">
          <a href={`/api/pay?t=${d.token}`} className="bg-[#8a7a52] px-6 py-3 text-[0.7rem] tracking-[0.22em] uppercase text-white hover:bg-[#6f6241]">
            {d.lang === "es" ? "Pagar con tarjeta" : "Pay by card"}
          </a>
        </div>
      )}
      <div className="mb-4 flex justify-end print:hidden">
        <div className="flex flex-wrap justify-end gap-2">
          {d.kind === "invoice" && d.items.some((l) => l.item_id) && (
            <a href={`/d/${d.token}/certificate`} target="_blank" rel="noreferrer" className="border border-[#1b1f1c] px-5 py-2.5 text-[0.68rem] tracking-[0.22em] uppercase hover:bg-[#1b1f1c] hover:text-white">
              {d.lang === "es" ? "Certificado" : "Certificate"}
            </a>
          )}
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
              <p className="font-display text-xl tracking-[0.14em] uppercase sm:text-2xl sm:tracking-[0.18em]">{s.doc_company}</p>
              <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-[#5d625e]">
                {s.doc_address}
                {"\n"}
                {[s.doc_phone, s.doc_email].filter(Boolean).join(" · ")}
                {s.doc_tax_id ? `\nEIN ${s.doc_tax_id}` : ""}
              </p>
            </div>
          </div>
          <div className="w-full sm:w-auto sm:text-right">
            <h1 className={`font-display font-light tracking-[0.06em] ${consign || sourcing || receipt || d.kind === "proforma" ? "text-[1.7rem] leading-tight" : "text-4xl"}`}>{t[d.kind]}</h1>
            <dl className="mt-3 grid grid-cols-[auto_auto] justify-start gap-x-4 gap-y-1 text-xs sm:justify-end">
              <dt className="text-[#5d625e]">{t.number}</dt><dd>{d.number}</dd>
              <dt className="text-[#5d625e]">{t.date}</dt><dd>{date(d.issue_date)}</dd>
              {d.due_date && t.due[d.kind] && (<><dt className="text-[#5d625e]">{t.due[d.kind]}</dt><dd>{date(d.due_date)}</dd></>)}
            </dl>
          </div>
        </header>

        <section className="py-7">
          <p className="text-[0.62rem] tracking-[0.24em] uppercase text-[#8a7a52]">{receipt ? (d.return_of === "memo" ? t.returnedBy : t.returnedTo) : t.billTo[d.kind]}</p>
          <p className="mt-2 font-display text-xl">{d.client_name}</p>
          <p className="whitespace-pre-line text-sm text-[#5d625e]">
            {[d.client_company, d.client_address, [d.client_phone, d.client_email].filter(Boolean).join(" · "), sellerId && `${t.sellerId}: ${sellerId}`].filter(Boolean).join("\n")}
          </p>
        </section>

        {/* Móvil: cada reloj en bloque (la tabla de cuatro columnas no cabe) */}
        <div className="border-t border-[#d8d2c4] sm:hidden">
          {d.items.map((l, i) => (
            <div key={i} className="border-b border-[#ece7dc] py-4">
              <p className="font-display text-lg leading-tight">{l.title}</p>
              {l.details && <p className="mt-1 text-xs text-[#5d625e]">{l.details}</p>}
              {d.show_serial && l.serial && <p className="mt-1 text-xs text-[#5d625e]">{t.serial}: {l.serial}</p>}
              {!noPrice && (
                <p className="mt-2 flex justify-between text-sm tabular-nums">
                  <span className="text-[#5d625e]">{l.qty} × {usd(l.price)}</span>
                  <span>{usd(l.qty * l.price)}</span>
                </p>
              )}
            </div>
          ))}
        </div>

        <table className="hidden w-full text-sm sm:table">
          <thead>
            <tr className="border-y border-[#d8d2c4] text-left text-[0.6rem] tracking-[0.2em] uppercase text-[#5d625e]">
              <th className="py-3 font-normal">{sourcing ? t.sought : t.item}</th>
              <th className="py-3 text-center font-normal">{t.qty}</th>
              {!noPrice && <th className="py-3 pl-4 text-right font-normal">{t.price}</th>}
              {!noPrice && <th className="py-3 pl-4 text-right font-normal">{consign ? t.net : t.amount}</th>}
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
                {!noPrice && <td className="py-4 pl-4 text-right tabular-nums">{usd(l.price)}</td>}
                {!noPrice && <td className="py-4 pl-4 text-right tabular-nums">{usd(l.qty * l.price)}</td>}
              </tr>
            ))}
          </tbody>
        </table>

        {svc && (
          <section className="mt-8 text-sm">
            <p className="mb-2 text-[0.62rem] tracking-[0.24em] uppercase text-[#8a7a52]">{t.svc.piece}</p>
            <p className="font-display text-lg">{svc.piece}</p>
            <p className="mt-2 text-xs text-[#5d625e]">{t.svc.status}: {t.svc.states[svc.status]}{d.due_date && svc.status !== "delivered" ? ` · ${t.due.service} ${date(d.due_date)}` : ""}</p>
            {svc.photos?.length > 0 && (
              <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4">
                {svc.photos.map((_, i) => (
                  <a key={i} href={`/api/insp-photo?t=${d.token}&i=${i}`} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/insp-photo?t=${d.token}&i=${i}`} alt="" className="aspect-square w-full border border-[#d8d2c4] object-cover" />
                  </a>
                ))}
              </div>
            )}
          </section>
        )}

        {insp && (
          <section className="mt-8 text-sm">
            <p className="mb-3 text-[0.62rem] tracking-[0.24em] uppercase text-[#8a7a52]">{insp.direction === "out" ? t.insp.titleOut : t.insp.title}</p>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-3">
              {INSPECTION_PARTS.map((p) => (
                <div key={p} className="flex justify-between gap-3 border-b border-[#d8d2c4] py-1.5">
                  <dt className="text-[#5d625e]">{PART_LABEL[d.lang][p]}</dt>
                  <dd className={insp.parts?.[p] === "damage" ? "text-[#9b2c2c]" : ""}>{STATE_LABEL[d.lang][insp.parts?.[p] ?? "ok"]}</dd>
                </div>
              ))}
            </dl>
            <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-4">
              <div><dt className="text-[0.6rem] tracking-[0.18em] uppercase text-[#8a7a52]">{t.insp.runs}</dt><dd>{insp.runs == null ? "—" : insp.runs ? t.insp.runsYes : t.insp.runsNo}</dd></div>
              <div><dt className="text-[0.6rem] tracking-[0.18em] uppercase text-[#8a7a52]">{t.insp.rate}</dt><dd>{insp.rate ?? "—"}</dd></div>
              <div><dt className="text-[0.6rem] tracking-[0.18em] uppercase text-[#8a7a52]">{t.insp.power}</dt><dd>{insp.power_reserve ?? "—"}</dd></div>
              <div><dt className="text-[0.6rem] tracking-[0.18em] uppercase text-[#8a7a52]">{t.insp.links}</dt><dd>{insp.links ?? "—"}</dd></div>
            </dl>
            <p className="mt-4"><span className="text-[0.6rem] tracking-[0.18em] uppercase text-[#8a7a52]">{t.insp.set}: </span>{[insp.box && t.insp.box, insp.papers && t.insp.papers, insp.extras].filter(Boolean).join(" · ") || "—"}</p>
            {insp.notes && <p className="mt-3 whitespace-pre-line"><span className="text-[0.6rem] tracking-[0.18em] uppercase text-[#8a7a52]">{t.conditionNote}: </span>{insp.notes}</p>}
            {insp.photos?.length > 0 && (
              <div className="mt-4">
                <p className="mb-2 text-[0.6rem] tracking-[0.18em] uppercase text-[#8a7a52]">{t.insp.photos}</p>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {insp.photos.map((_, i) => (
                    <a key={i} href={`/api/insp-photo?t=${d.token}&i=${i}`} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/insp-photo?t=${d.token}&i=${i}`} alt="" className="aspect-square w-full border border-[#d8d2c4] object-cover" />
                    </a>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        <div className={`mt-6 flex justify-end ${noPrice ? "hidden" : ""}`}>
          <dl className="grid w-full grid-cols-[1fr_auto] gap-y-2 text-sm sm:max-w-[300px]">
            <dt className="text-[#5d625e]">{t.subtotal}</dt><dd className="text-right tabular-nums">{usd(totals.subtotal)}</dd>
            {totals.discount > 0 && (<><dt className="text-[#5d625e]">{t.discount}</dt><dd className="text-right tabular-nums">−{usd(totals.discount)}</dd></>)}
            {totals.tax > 0 && (<><dt className="text-[#5d625e]">{t.tax} ({Number(d.tax_rate)}%)</dt><dd className="text-right tabular-nums">{usd(totals.tax)}</dd></>)}
            {totals.shipping > 0 && (<><dt className="text-[#5d625e]">{t.shipping}</dt><dd className="text-right tabular-nums">{usd(totals.shipping)}</dd></>)}
            <dt className="mt-2 border-t border-[#1b1f1c] pt-3 font-display text-xl">{consign ? t.netTotal : purchase ? t.paidTotal : sourcing ? t.upTo : t.total}</dt>
            <dd className="mt-2 border-t border-[#1b1f1c] pt-3 text-right font-display text-xl tabular-nums">{usd(totals.total)}</dd>
            {sourcing && deposit > 0 && (
              <>
                <dt className="text-[#5d625e]">{d.refunded_at && d.deposit_paid_at ? t.depositRefunded : d.deposit_paid_at ? t.depositPaid : t.depositDue}</dt>
                <dd className="text-right tabular-nums">{usd(deposit)}</dd>
              </>
            )}
            {d.kind === "proforma" && (
              <>
                {(d.payments ?? []).map((p, i) => (
                  <Fragment key={i}><dt className="text-[#5d625e]">{t.paymentLine} {date(p.date)}{p.method ? ` · ${p.method}` : ""}</dt><dd className="text-right tabular-nums">−{usd(p.amount)}</dd></Fragment>
                ))}
                <dt className="font-display text-lg">{t.balance}</dt><dd className="text-right font-display text-lg tabular-nums">{usd(Math.max(0, Number(d.total) - paidSoFar(d)))}</dd>
              </>
            )}
            {d.kind === "invoice" && deposit > 0 && (
              <>
                <dt className="text-[#5d625e]">{t.lessDeposit}</dt><dd className="text-right tabular-nums">−{usd(deposit)}</dd>
                <dt className="font-display text-lg">{d.status === "paid" ? t.balancePaid : t.balance}</dt><dd className="text-right font-display text-lg tabular-nums">{usd(balanceDue(d))}</dd>
              </>
            )}
          </dl>
        </div>

        <footer className="mt-10 grid gap-6 border-t border-[#d8d2c4] pt-6 text-xs leading-relaxed text-[#4a4f4b]">
          {d.notes && (
            <div><p className="mb-1 text-[0.6rem] tracking-[0.2em] uppercase text-[#8a7a52]">{receipt ? t.conditionNote : t.notes}</p><p className="whitespace-pre-line">{d.notes}</p></div>
          )}
          {d.kind !== "memo" && !consign && !noPrice && (d.payment_method || (!purchase && s.doc_payment_info)) && (
            <div>
              <p className="mb-1 text-[0.6rem] tracking-[0.2em] uppercase text-[#8a7a52]">{t.payment}</p>
              <p className="whitespace-pre-line">{[d.payment_method, d.status === "paid" || purchase ? null : s.doc_payment_info].filter(Boolean).join("\n")}</p>
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
          {twoParty && (
            <div className="mt-8 grid gap-10 sm:grid-cols-2">
              {(d.kind === "inspection" ? t.insp.sign : d.kind === "service" ? t.svc.sign : purchase ? t.purchaseSign : sourcing ? t.sourcingSign : receipt ? t.returnSign[d.return_of === "memo" ? "memo" : "consignment"] : t.consignSign).map((who) => (
                <div key={who}>
                  <p className="border-t border-[#1b1f1c] pt-2">{who}</p>
                  <p className="mt-6 border-t border-[#1b1f1c] pt-2">{t.date}</p>
                </div>
              ))}
            </div>
          )}
          {signature && (
            <div className="mt-6 border-t border-[#d8d2c4] pt-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={signature} alt="" className="h-20 w-auto" />
              <p className="mt-1 text-[0.7rem] text-[#5d625e]">
                {twoParty || d.kind === "memo" ? t.signedBy : t.acceptedBy} <b>{d.signer_name}</b> · {signedOn} (Miami)
              </p>
            </div>
          )}
        </footer>
      </article>
      {!d.signed_at && d.status === "sent" && SIGNABLE.includes(d.kind) && <SignaturePad token={d.token} lang={d.lang} defaultName={d.client_name ?? ""} />}
    </main>
  );
}
