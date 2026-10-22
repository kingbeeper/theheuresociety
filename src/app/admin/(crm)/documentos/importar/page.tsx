import Link from "next/link";
import { connection } from "next/server";
import { requireUser } from "@/lib/admin-auth";
import { tr } from "@/lib/admin-i18n";
import { PageTitle } from "@/components/admin/ui";
import { ImportInvoices } from "@/components/admin/ImportInvoices";

export const metadata = { title: "Importar facturas" };

// Facturas de antes del CRM: PDF, foto o Excel → cliente, factura pagada y venta en el inventario
export default async function ImportPage() {
  await connection();
  await requireUser("documentos");
  return (
    <>
      <Link href="/admin/documentos" className="text-[0.66rem] tracking-[0.2em] uppercase text-stone hover:text-ivory">{tr("← Documentos")}</Link>
      <PageTitle eyebrow="Documentos" title="Importar facturas antiguas" />
      <p className="mb-6 max-w-3xl text-sm text-stone">
        {tr("Sube las facturas de antes del CRM en PDF o en foto (la IA lee los datos) o un Excel con la plantilla. Revisa y corrige lo leído y pulsa «Importar»: se crea (o completa) la ficha del cliente, la factura pagada con su número original y la venta de cada pieza en el inventario, con su serial. Así cuentan en Clientes, en los informes y en el historial de seriales.")}
      </p>
      <ImportInvoices />
    </>
  );
}
