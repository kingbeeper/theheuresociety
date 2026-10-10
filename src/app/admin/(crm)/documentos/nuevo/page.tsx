import Link from "next/link";
import { connection } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { formOptions, getDocSettings } from "@/lib/documents";
import { KIND_LABEL, type DocKind } from "@/lib/doc-labels";
import { todayInMiami } from "@/lib/booking";
import { Card, PageTitle, requestTime } from "@/components/admin/ui";
import { DocumentForm } from "@/components/admin/DocumentForm";

export const metadata = { title: "Nuevo documento" };

export default async function NewDocumentPage({ searchParams }: PageProps<"/admin/documentos/nuevo">) {
  await connection();
  await requireAdmin("documentos");
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const tipo = one(sp.tipo);
  const kind = (tipo && tipo in KIND_LABEL ? tipo : "quote") as DocKind;
  const [{ customers, stock }, s] = await Promise.all([formOptions(), getDocSettings()]);

  return (
    <>
      <Link href="/admin/documentos" className="text-[0.66rem] tracking-[0.2em] uppercase text-stone hover:text-ivory">← Documentos</Link>
      <PageTitle eyebrow="Documentos" title={kind === "memo" ? "Nuevo memo" : kind === "consignment" ? "Nuevo contrato de consignación" : kind === "purchase" ? "Nuevo contrato de compra" : kind === "sourcing" ? "Nuevo encargo" : `Nueva ${KIND_LABEL[kind].toLowerCase()}`} />
      <Card>
        <DocumentForm
          kind={kind}
          customers={customers}
          stock={stock}
          terms={{ quote: s.doc_terms_quote, memo: s.doc_terms_memo, invoice: s.doc_terms_invoice, consignment: s.doc_terms_consignment, purchase: s.doc_terms_purchase, sourcing: s.doc_terms_sourcing }}
          taxRate={Number(s.doc_tax_rate) || 0}
          today={todayInMiami(new Date(requestTime()))}
          presetCustomer={one(sp.cliente)}
          presetItem={one(sp.reloj)}
        />
      </Card>
    </>
  );
}
