import Link from "next/link";
import { connection } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { getDocSettings } from "@/lib/documents";
import { Card, PageTitle } from "@/components/admin/ui";
import { DocSettingsForm } from "@/components/admin/DocSettingsForm";

export const metadata = { title: "Ajustes de documentos" };

export default async function DocSettingsPage() {
  await connection();
  await requireAdmin("usuarios");
  const s = await getDocSettings();
  return (
    <>
      <Link href="/admin/documentos" className="text-[0.66rem] tracking-[0.2em] uppercase text-stone hover:text-ivory">← Documentos</Link>
      <PageTitle eyebrow="Documentos" title="Datos que salen en cotizaciones, memos y facturas" />
      <Card>
        <DocSettingsForm s={s} />
      </Card>
    </>
  );
}
