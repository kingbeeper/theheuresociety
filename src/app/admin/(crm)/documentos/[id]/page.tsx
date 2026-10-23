import { tr, trParts, dateLocale } from "@/lib/admin-i18n";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { adminDb } from "@/lib/supabase";
import { requireUser } from "@/lib/admin-auth";
import { can } from "@/lib/crm-perms";
import { formOptions, getDoc, getDocSettings } from "@/lib/documents";
import { KIND_LABEL, PRINT, SERVICE_STATUS, STATUS_LABEL, STATUS_STYLE, balanceDue, paidSoFar, usd } from "@/lib/doc-labels";
import { PAYMENT } from "@/lib/stock-labels";
import { readyMessage } from "@/lib/service";
import { todayInMiami } from "@/lib/booking";
import { SITE_URL } from "@/lib/seo";
import { Card, fmtDate, ghostButtonClass, PageTitle, requestTime } from "@/components/admin/ui";
import { ShipmentCard } from "@/components/admin/ShipmentCard";
import { DocPhotoUpload } from "@/components/admin/DocPhotoUpload";
import { CloseProformaForm, DepositForm, DocumentForm, PaidForm, ProformaPaymentForm, SourcedForm } from "@/components/admin/DocumentForm";
import { refreshDocPhotosAction, serviceStepAction, convertToInvoice, convertToProforma, deleteDocument, markConsignorPaid, refundSourcing, returnMemo, sendDocument, setQuoteResult, voidDocument } from "../../../document-actions";

export const metadata = { title: "Documento" };

export default async function DocumentPage({ params }: PageProps<"/admin/documentos/[id]">) {
  await connection();
  const me = await requireUser("documentos");
  const showCosts = can(me, "costos");
  const { id } = await params;
  const d = await getDoc(id);
  if (!d) notFound();
  const [{ customers, stock }, s, related] = await Promise.all([
    formOptions(),
    getDocSettings(),
    adminDb().from("documents").select("id, kind, number").or(`id.eq.${d.source_id ?? d.id},source_id.eq.${d.id}`).neq("id", d.id),
  ]);
  const today = todayInMiami(new Date(requestTime()));
  const link = `${SITE_URL}/d/${d.token}`;
  const t = PRINT[d.lang];
  const editable = d.status === "draft" || d.status === "sent";
  const late = d.status === "sent" && d.kind !== "quote" && d.due_date && d.due_date < today;
  const lateLabel = d.kind === "memo" ? "Memo vencido" : d.kind === "consignment" || d.kind === "sourcing" ? "Plazo cumplido" : "Vencida";
  const sourcing = d.kind === "sourcing";
  const proforma = d.kind === "proforma";
  const deposit = Number(d.deposit ?? 0);
  const pfPaid = paidSoFar(d);
  const pfBalance = Math.max(0, Math.round((Number(d.total) - pfPaid) * 100) / 100);

  // Mensaje listo para enviar el enlace por WhatsApp o correo
  const first = (d.client_name ?? "").split(" ")[0];
  const message =
    d.lang === "es"
      ? `Hola ${first}, le comparto su ${d.kind === "proforma" ? "factura" : KIND_LABEL[d.kind].toLowerCase()} ${d.number} de The Heure Society (${usd(d.total)}): ${link}`
      : `Hi ${first}, here is your ${t[d.kind].toLowerCase()} ${d.number} from The Heure Society (${usd(d.total)}): ${link}`;
  const phone = d.client_phone?.replace(/\D/g, "");
  const button = "bg-ivory px-5 py-2.5 text-[0.68rem] tracking-[0.22em] uppercase text-ink hover:bg-brass";

  return (
    <>
      <Link href="/admin/documentos" className="text-[0.66rem] tracking-[0.2em] uppercase text-stone hover:text-ivory">{tr("← Documentos")}</Link>
      <PageTitle
        eyebrow={tr(KIND_LABEL[d.kind])}
        title={`${d.number} · ${d.client_name ?? ""}`}
        action={
          <div className="flex flex-wrap gap-2">
            <a href={`/d/${d.token}`} target="_blank" rel="noreferrer" className={ghostButtonClass}>{tr("Ver")}</a>
            {d.status !== "draft" && <a href={`/d/${d.token}/pdf`} target="_blank" rel="noreferrer" className={ghostButtonClass}>PDF</a>}
            {d.id_photo_path && <a href={`/api/private/id/${d.id}`} target="_blank" rel="noreferrer" className={ghostButtonClass}>{tr("🪪 Identificación")}</a>}
            {d.kind === "invoice" && d.status !== "draft" && d.items.some((l) => l.item_id) && <a href={`/d/${d.token}/certificate`} target="_blank" rel="noreferrer" className={ghostButtonClass}>{tr("Certificado")}</a>}
            {phone && <a href={`https://wa.me/${phone}?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer" className={ghostButtonClass}>{tr("Enviar por WhatsApp")}</a>}
            {d.client_email && <a href={`mailto:${d.client_email}?subject=${encodeURIComponent(`${t[d.kind]} ${d.number} · The Heure Society`)}&body=${encodeURIComponent(message)}`} className={ghostButtonClass}>{tr("Enviar por correo")}</a>}
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-px border border-line bg-line md:grid-cols-4">
        {[
          ["Estado", late ? lateLabel : STATUS_LABEL[d.kind][d.status] ?? d.status],
          [tr(d.kind === "consignment" ? "Neto al dueño" : d.kind === "purchase" ? "Pagado al vendedor" : sourcing ? "Precio hasta" : "Total") + (d.kind === "invoice" && deposit ? ` · ${tr("saldo")} ${usd(balanceDue(d))}` : ""), usd(d.total)],
          proforma
            ? [`${tr("Pagado")} · ${tr("saldo")} ${usd(pfBalance)}`, usd(pfPaid)]
            : sourcing
            ? [deposit <= 0 ? "Sin anticipo" : d.refunded_at && d.deposit_paid_at ? "Anticipo devuelto" : d.deposit_paid_at ? `Anticipo recibido ${fmtDate(`${d.deposit_paid_at}T12:00:00`)}` : "Anticipo pendiente", deposit > 0 ? usd(deposit) : "—"]
            : ["Fecha", fmtDate(`${d.issue_date}T12:00:00`)],
          [tr(sourcing ? "Plazo de búsqueda hasta" : d.kind === "quote" ? "Válida hasta" : d.kind === "memo" ? "Devolver antes de" : d.kind === "consignment" ? (d.status === "paid" ? "Pagada al dueño el" : "Vigente hasta") : d.status === "paid" ? "Pagada el" : "Vence"), d.status === "paid" && d.paid_at ? fmtDate(`${d.paid_at}T12:00:00`) : d.due_date ? fmtDate(`${d.due_date}T12:00:00`) : "—"],
        ].map(([l, v]) => (
          <div key={l} className="bg-forest px-5 py-4">
            <p className={`font-display text-2xl font-light ${l === "Estado" ? (late ? "text-red-200" : STATUS_STYLE[d.status]) : ""}`}>{v}</p>
            <p className="mt-1 text-[0.6rem] tracking-[0.16em] uppercase text-stone">{trParts(l)}</p>
          </div>
        ))}
      </div>

      {d.signed_at && (
        <p className="mt-6 border border-emerald-300/40 bg-emerald-300/5 p-4 text-sm">
          {tr("✍️ Firmado electrónicamente por")} <b>{d.signer_name}</b> {tr("el")} {new Intl.DateTimeFormat(dateLocale(), { dateStyle: "long", timeStyle: "short", timeZone: "America/New_York" }).format(new Date(d.signed_at))}
          {d.signed_ip ? <span className="text-stone"> {tr("· IP")} {d.signed_ip}</span> : null}
        </p>
      )}

      {(d.kind === "purchase" || d.kind === "consignment") && (
        <Card className="mt-6" title="📷 Fotos de la pieza al recibirla">
          {d.photos?.length ? (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {d.photos.map((_, i) => (
                <a key={i} href={`/api/doc-photo?t=${d.token}&i=${i}`} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/doc-photo?t=${d.token}&i=${i}`} alt="" loading="lazy" className="aspect-square w-full border border-line object-cover" />
                </a>
              ))}
            </div>
          ) : (
            <p className="text-sm text-stone">{tr("Esta pieza todavía no tiene fotos. Súbelas aquí (quedan también en la ficha de la pieza).")}</p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-stone">
            <span>{tr("Quedan guardadas en el contrato como prueba del estado en que se recibió la pieza, aunque luego cambie su ficha.")}</span>
            <DocPhotoUpload docId={d.id} />
            <form action={refreshDocPhotosAction.bind(null, d.id)}><button className={ghostButtonClass}>{tr("↻ Añadir las fotos nuevas de la pieza")}</button></form>
          </div>
        </Card>
      )}

      {/* Siguiente paso según el tipo y el estado */}
      <Card className="mt-6" title="Acciones">
        {d.kind === "service" && d.service && d.status === "sent" && (
          <div className="mb-4 grid gap-3 border-b border-line/60 pb-4 text-sm">
            <p>
              🔧 {tr("Estado")}: <span className="text-brass">{tr(SERVICE_STATUS[d.service.status])}</span>
              {d.service.provider ? <span className="text-stone"> · {d.service.provider}</span> : null}
              {d.due_date ? <span className="text-stone"> · {tr("Lista para")} {fmtDate(`${d.due_date}T12:00:00`)}</span> : null}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {d.service.status === "received" && (
                <form action={serviceStepAction.bind(null, d.id, "workshop")}><button className={ghostButtonClass}>{tr("🔧 Enviar al taller")}</button></form>
              )}
              {(d.service.status === "received" || d.service.status === "workshop") && (
                <form action={serviceStepAction.bind(null, d.id, "ready")}><button className={ghostButtonClass}>{tr("✅ Está lista")}</button></form>
              )}
              {d.service.status === "ready" && d.client_phone && (
                <a href={`https://wa.me/${d.client_phone.replace(/\D/g, "")}?text=${encodeURIComponent(readyMessage(d))}`} target="_blank" rel="noreferrer" className={ghostButtonClass}>{tr("📲 Avisar al cliente que está lista")}</a>
              )}
              <form action={serviceStepAction.bind(null, d.id, "delivered")} className="flex flex-wrap items-center gap-2">
                {Number(d.total) > 0 && (
                  <select name="payment_method" defaultValue="" className="border border-line bg-ink/60 px-2 py-2 text-xs">
                    <option value="">{tr("Forma de pago")}</option>
                    {Object.values(PAYMENT).map((p) => <option key={p} value={p}>{tr(p)}</option>)}
                  </select>
                )}
                <button className={button}>{Number(d.total) > 0 ? tr("💵 Entregar y cobrar ({m})", { m: usd(d.total) }) : tr("Entregada")}</button>
              </form>
            </div>
            {d.service.provider_cost != null && showCosts && Number(d.total) > 0 && (
              <p className="text-xs text-stone">{tr("Margen: {m} (cobras {a}, el taller cuesta {c})", { m: usd(Number(d.subtotal) - Number(d.service.provider_cost)), a: usd(d.subtotal), c: usd(d.service.provider_cost) })}</p>
            )}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {d.status === "draft" && (
            <form action={sendDocument.bind(null, d.id)}>
              <button className={button}>{d.kind === "memo" ? tr("Marcar como entregado") : d.kind === "invoice" ? tr("Emitir factura") : (d.kind === "consignment" || d.kind === "purchase" || sourcing) ? tr("Marcar como firmado") : proforma ? tr("Crear proforma (reserva la pieza)") : tr("Marcar como enviada")}</button>
            </form>
          )}
          {d.kind === "quote" && d.status === "sent" && (
            <>
              <form action={setQuoteResult.bind(null, d.id, true)}><button className={ghostButtonClass}>{tr("Aceptada")}</button></form>
              <form action={setQuoteResult.bind(null, d.id, false)}><button className={ghostButtonClass}>{tr("Rechazada")}</button></form>
            </>
          )}
          {d.kind === "quote" && ["draft", "sent", "accepted"].includes(d.status) && (
            <form action={convertToProforma.bind(null, d.id)}><button className={button}>{tr("Aceptada: hacer proforma")}</button></form>
          )}
          {((d.kind === "quote" && ["sent", "accepted"].includes(d.status)) || (d.kind === "memo" && d.status === "sent")) && (
            <form action={convertToInvoice.bind(null, d.id)}><button className={button}>{d.kind === "memo" ? tr("Se lo queda: facturar") : tr("Convertir en factura")}</button></form>
          )}
          {d.kind === "memo" && d.status === "sent" && (
            <form action={returnMemo.bind(null, d.id)}><button className={ghostButtonClass}>{tr("Reloj devuelto")}</button></form>
          )}
          {d.kind === "consignment" && d.status === "sent" && (
            <>
              <form action={markConsignorPaid.bind(null, d.id)}><button className={button}>{tr("Vendido: pagado al dueño")}</button></form>
              <form action={returnMemo.bind(null, d.id)}><button className={ghostButtonClass}>{tr("Devuelto al dueño")}</button></form>
            </>
          )}
          {sourcing && d.status === "sent" && (
            <form action={refundSourcing.bind(null, d.id)}><button className={ghostButtonClass}>{d.deposit_paid_at ? tr("No se consiguió: anticipo devuelto") : tr("Cerrar sin conseguir")}</button></form>
          )}
          {d.status !== "void" && d.status !== "paid" && d.status !== "converted" && d.status !== "returned" && (
            <form action={voidDocument.bind(null, d.id)}><button className={ghostButtonClass}>{tr("Anular")}</button></form>
          )}
          {d.status === "draft" && (
            <form action={deleteDocument.bind(null, d.id)}><button className="px-2 text-xs text-stone underline hover:text-red-200">{tr("Eliminar borrador")}</button></form>
          )}
        </div>
        {d.kind === "invoice" && d.status === "sent" && (
          <div className="mt-5 border-t border-line pt-5">
            <PaidForm id={d.id} today={today} method={d.payment_method} />
            <p className="mt-2 text-xs text-stone">{tr("Al marcarla pagada, los relojes del inventario quedan vendidos (también en la web) y el cliente pasa a «Ganado».")}</p>
          </div>
        )}
        {proforma && (d.status === "draft" || d.status === "sent") && (
          <div className="mt-5 grid gap-5 border-t border-line pt-5">
            {(d.payments ?? []).length > 0 && (
              <ul className="space-y-1 text-sm">
                {(d.payments ?? []).map((p, i) => (
                  <li key={i}>💵 {fmtDate(`${p.date}T12:00:00`)} · <b>{usd(p.amount)}</b>{p.method ? ` · ${p.method}` : ""}</li>
                ))}
                <li className="text-stone">{tr("Pagado")} {usd(pfPaid)} de {usd(d.total)} {tr("· saldo")} <b className="text-ivory">{usd(pfBalance)}</b></li>
              </ul>
            )}
            <ProformaPaymentForm id={d.id} today={today} />
            <div className="border-t border-line/60 pt-5">
              <CloseProformaForm id={d.id} today={today} balance={pfBalance} />
              <p className="mt-2 text-xs text-stone">{tr("Al saldarla se registra el saldo como último pago y se crea la")} <b>{tr("factura pagada")}</b> {tr("con los depósitos descontados; el reloj queda vendido (inventario y web).")}</p>
            </div>
          </div>
        )}
        {sourcing && deposit > 0 && (d.status === "draft" || d.status === "sent") && !d.deposit_paid_at && (
          <div className="mt-5 border-t border-line pt-5">
            <DepositForm id={d.id} today={today} />
          </div>
        )}
        {sourcing && d.deposit_paid_at && <p className="mt-3 text-sm text-emerald-200">{tr("💵 Anticipo de")} {usd(deposit)} {tr("recibido el")} {fmtDate(`${d.deposit_paid_at}T12:00:00`)}{d.deposit_method ? ` · ${d.deposit_method}` : ""}{d.refunded_at ? ` · ${tr("devuelto el")} ${fmtDate(`${d.refunded_at}T12:00:00`)}` : ""}</p>}
        {sourcing && d.status === "sent" && (
          <div className="mt-5 border-t border-line pt-5">
            <Link href={`/admin/dealers?encargo=${d.id}`} className="inline-block border border-emerald-300/40 px-4 py-2 text-[0.66rem] tracking-[0.2em] uppercase text-emerald-200 hover:bg-emerald-300/10">{tr("🤝 Pedir este reloj a mis dealers")}</Link>
          </div>
        )}
        {sourcing && d.status === "sent" && (
          <div className="mt-5 border-t border-line pt-5">
            <SourcedForm id={d.id} stock={stock} price={Number(d.total)} />
            <p className="mt-2 text-xs text-stone">{tr("Se crea la factura con el reloj y")} {d.deposit_paid_at ? tr("el anticipo de {m} descontado del saldo", { m: usd(deposit) }) : tr("sin anticipo (no consta como pagado)")}{tr(". Si el reloj ya está en el inventario, elígelo: quedará reservado al emitirla y vendido al pagarla.")}</p>
          </div>
        )}
        {d.kind === "consignment" && d.status === "sent" && (
          <p className="mt-3 text-xs text-stone">{tr("Registra la venta del reloj en el inventario (o con una factura). Al marcar «Devuelto al dueño», el reloj sale del inventario y de la web.")}</p>
        )}
        {(d.kind === "memo" || d.kind === "invoice") && d.status === "draft" && (
          <p className="mt-3 text-xs text-stone">{tr("Al")} {d.kind === "memo" ? "entregarlo" : "emitirla"}{tr(", los relojes del inventario quedan reservados (también en la web).")}</p>
        )}
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone">
          {d.customer_id && <Link href={`/admin/leads/${d.customer_id}`} className="hover:text-ivory">{tr("Ficha del cliente →")}</Link>}
          {d.items.filter((l) => l.item_id).map((l) => (
            <Link key={l.item_id} href={`/admin/inventario/${l.item_id}`} className="hover:text-ivory">{l.sku ?? tr("Reloj")} {tr("en inventario →")}</Link>
          ))}
          {(related.data ?? []).map((r) => (
            <Link key={r.id} href={`/admin/documentos/${r.id}`} className="hover:text-ivory">{tr(KIND_LABEL[r.kind as keyof typeof KIND_LABEL])} {r.number} →</Link>
          ))}
        </div>
        <p className="mt-4 break-all text-xs text-stone/80">{tr("Enlace para el cliente (privado, sin costos ni datos internos):")} {link}</p>
      </Card>
      {["invoice", "memo", "proforma", "consignment", "return", "sourcing"].includes(d.kind) && d.status !== "draft" && d.status !== "void" && <ShipmentCard d={d} />}

      <Card className="mt-6" title={editable ? "Editar" : "Contenido"}>
        {editable ? (
          <DocumentForm
            showCosts={can(me, "costos")}
            doc={d}
            kind={d.kind}
            customers={customers}
            stock={[...stock, ...d.items.filter((l) => l.item_id && !stock.some((x) => x.id === l.item_id)).map((l) => ({ id: l.item_id!, sku: l.sku ?? "", title: l.title, details: l.details ?? "", serial: l.serial ?? null, price: l.price }))]}
            terms={{ quote: s.doc_terms_quote, memo: s.doc_terms_memo, invoice: s.doc_terms_invoice, consignment: s.doc_terms_consignment, purchase: s.doc_terms_purchase, sourcing: s.doc_terms_sourcing, proforma: s.doc_terms_proforma, return: s.doc_terms_return, inspection: s.doc_terms_inspection, service: s.doc_terms_service }}
            taxRate={Number(s.doc_tax_rate) || 0}
            today={today}
          />
        ) : (
          <ul className="space-y-2 text-sm">
            {d.items.map((l, i) => (
              <li key={i} className="flex justify-between gap-3 border-b border-line/60 pb-2">
                <span>{l.title}{l.details ? <span className="text-stone"> · {l.details}</span> : null}</span>
                <span className="tabular-nums">{usd(l.qty * l.price)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
