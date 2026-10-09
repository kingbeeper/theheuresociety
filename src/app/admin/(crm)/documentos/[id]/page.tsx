import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { adminDb } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";
import { formOptions, getDoc, getDocSettings } from "@/lib/documents";
import { KIND_LABEL, PRINT, STATUS_LABEL, STATUS_STYLE, usd } from "@/lib/doc-labels";
import { todayInMiami } from "@/lib/booking";
import { SITE_URL } from "@/lib/seo";
import { Card, fmtDate, ghostButtonClass, PageTitle, requestTime } from "@/components/admin/ui";
import { DocumentForm, PaidForm } from "@/components/admin/DocumentForm";
import { convertToInvoice, deleteDocument, markConsignorPaid, returnMemo, sendDocument, setQuoteResult, voidDocument } from "../../../document-actions";

export const metadata = { title: "Documento" };

export default async function DocumentPage({ params }: PageProps<"/admin/documentos/[id]">) {
  await connection();
  await requireAdmin("documentos");
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
  const lateLabel = d.kind === "memo" ? "Memo vencido" : d.kind === "consignment" ? "Plazo cumplido" : "Vencida";

  // Mensaje listo para enviar el enlace por WhatsApp o correo
  const first = (d.client_name ?? "").split(" ")[0];
  const message =
    d.lang === "es"
      ? `Hola ${first}, le comparto su ${KIND_LABEL[d.kind].toLowerCase()} ${d.number} de The Heure Society (${usd(d.total)}): ${link}`
      : `Hi ${first}, here is your ${t[d.kind].toLowerCase()} ${d.number} from The Heure Society (${usd(d.total)}): ${link}`;
  const phone = d.client_phone?.replace(/\D/g, "");
  const button = "bg-ivory px-5 py-2.5 text-[0.68rem] tracking-[0.22em] uppercase text-ink hover:bg-brass";

  return (
    <>
      <Link href="/admin/documentos" className="text-[0.66rem] tracking-[0.2em] uppercase text-stone hover:text-ivory">← Documentos</Link>
      <PageTitle
        eyebrow={KIND_LABEL[d.kind]}
        title={`${d.number} · ${d.client_name ?? ""}`}
        action={
          <div className="flex flex-wrap gap-2">
            <a href={`/d/${d.token}`} target="_blank" rel="noreferrer" className={ghostButtonClass}>Ver</a>
            {d.status !== "draft" && <a href={`/d/${d.token}/pdf`} target="_blank" rel="noreferrer" className={ghostButtonClass}>PDF</a>}
            {d.kind === "invoice" && d.status !== "draft" && d.items.some((l) => l.item_id) && <a href={`/d/${d.token}/certificate`} target="_blank" rel="noreferrer" className={ghostButtonClass}>Certificado</a>}
            {phone && <a href={`https://wa.me/${phone}?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer" className={ghostButtonClass}>Enviar por WhatsApp</a>}
            {d.client_email && <a href={`mailto:${d.client_email}?subject=${encodeURIComponent(`${d.lang === "es" ? KIND_LABEL[d.kind] : t[d.kind]} ${d.number} · The Heure Society`)}&body=${encodeURIComponent(message)}`} className={ghostButtonClass}>Enviar por correo</a>}
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-px border border-line bg-line md:grid-cols-4">
        {[
          ["Estado", late ? lateLabel : STATUS_LABEL[d.kind][d.status] ?? d.status],
          [d.kind === "consignment" ? "Neto al dueño" : d.kind === "purchase" ? "Pagado al vendedor" : "Total", usd(d.total)],
          ["Fecha", fmtDate(`${d.issue_date}T12:00:00`)],
          [d.kind === "quote" ? "Válida hasta" : d.kind === "memo" ? "Devolver antes de" : d.kind === "consignment" ? (d.status === "paid" ? "Pagada al dueño el" : "Vigente hasta") : d.status === "paid" ? "Pagada el" : "Vence", d.status === "paid" && d.paid_at ? fmtDate(`${d.paid_at}T12:00:00`) : d.due_date ? fmtDate(`${d.due_date}T12:00:00`) : "—"],
        ].map(([l, v]) => (
          <div key={l} className="bg-forest px-5 py-4">
            <p className={`font-display text-2xl font-light ${l === "Estado" ? (late ? "text-red-200" : STATUS_STYLE[d.status]) : ""}`}>{v}</p>
            <p className="mt-1 text-[0.6rem] tracking-[0.16em] uppercase text-stone">{l}</p>
          </div>
        ))}
      </div>

      {/* Siguiente paso según el tipo y el estado */}
      <Card className="mt-6" title="Acciones">
        <div className="flex flex-wrap items-center gap-2">
          {d.status === "draft" && (
            <form action={sendDocument.bind(null, d.id)}>
              <button className={button}>{d.kind === "memo" ? "Marcar como entregado" : d.kind === "invoice" ? "Emitir factura" : (d.kind === "consignment" || d.kind === "purchase") ? "Marcar como firmado" : "Marcar como enviada"}</button>
            </form>
          )}
          {d.kind === "quote" && d.status === "sent" && (
            <>
              <form action={setQuoteResult.bind(null, d.id, true)}><button className={ghostButtonClass}>Aceptada</button></form>
              <form action={setQuoteResult.bind(null, d.id, false)}><button className={ghostButtonClass}>Rechazada</button></form>
            </>
          )}
          {((d.kind === "quote" && ["sent", "accepted"].includes(d.status)) || (d.kind === "memo" && d.status === "sent")) && (
            <form action={convertToInvoice.bind(null, d.id)}><button className={button}>{d.kind === "memo" ? "Se lo queda: facturar" : "Convertir en factura"}</button></form>
          )}
          {d.kind === "memo" && d.status === "sent" && (
            <form action={returnMemo.bind(null, d.id)}><button className={ghostButtonClass}>Reloj devuelto</button></form>
          )}
          {d.kind === "consignment" && d.status === "sent" && (
            <>
              <form action={markConsignorPaid.bind(null, d.id)}><button className={button}>Vendido: pagado al dueño</button></form>
              <form action={returnMemo.bind(null, d.id)}><button className={ghostButtonClass}>Devuelto al dueño</button></form>
            </>
          )}
          {d.status !== "void" && d.status !== "paid" && d.status !== "converted" && (
            <form action={voidDocument.bind(null, d.id)}><button className={ghostButtonClass}>Anular</button></form>
          )}
          {d.status === "draft" && (
            <form action={deleteDocument.bind(null, d.id)}><button className="px-2 text-xs text-stone underline hover:text-red-200">Eliminar borrador</button></form>
          )}
        </div>
        {d.kind === "invoice" && d.status === "sent" && (
          <div className="mt-5 border-t border-line pt-5">
            <PaidForm id={d.id} today={today} method={d.payment_method} />
            <p className="mt-2 text-xs text-stone">Al marcarla pagada, los relojes del inventario quedan vendidos (también en la web) y el cliente pasa a «Ganado».</p>
          </div>
        )}
        {d.kind === "consignment" && d.status === "sent" && (
          <p className="mt-3 text-xs text-stone">Registra la venta del reloj en el inventario (o con una factura). Al marcar «Devuelto al dueño», el reloj sale del inventario y de la web.</p>
        )}
        {(d.kind === "memo" || d.kind === "invoice") && d.status === "draft" && (
          <p className="mt-3 text-xs text-stone">Al {d.kind === "memo" ? "entregarlo" : "emitirla"}, los relojes del inventario quedan reservados (también en la web).</p>
        )}
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone">
          {d.customer_id && <Link href={`/admin/leads/${d.customer_id}`} className="hover:text-ivory">Ficha del cliente →</Link>}
          {d.items.filter((l) => l.item_id).map((l) => (
            <Link key={l.item_id} href={`/admin/inventario/${l.item_id}`} className="hover:text-ivory">{l.sku ?? "Reloj"} en inventario →</Link>
          ))}
          {(related.data ?? []).map((r) => (
            <Link key={r.id} href={`/admin/documentos/${r.id}`} className="hover:text-ivory">{KIND_LABEL[r.kind as keyof typeof KIND_LABEL]} {r.number} →</Link>
          ))}
        </div>
        <p className="mt-4 break-all text-xs text-stone/80">Enlace para el cliente (privado, sin costos ni datos internos): {link}</p>
      </Card>

      <Card className="mt-6" title={editable ? "Editar" : "Contenido"}>
        {editable ? (
          <DocumentForm
            doc={d}
            kind={d.kind}
            customers={customers}
            stock={[...stock, ...d.items.filter((l) => l.item_id && !stock.some((x) => x.id === l.item_id)).map((l) => ({ id: l.item_id!, sku: l.sku ?? "", title: l.title, details: l.details ?? "", serial: l.serial ?? null, price: l.price }))]}
            terms={{ quote: s.doc_terms_quote, memo: s.doc_terms_memo, invoice: s.doc_terms_invoice, consignment: s.doc_terms_consignment, purchase: s.doc_terms_purchase }}
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
