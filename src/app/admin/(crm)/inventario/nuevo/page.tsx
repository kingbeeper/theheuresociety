import Link from "next/link";
import { connection } from "next/server";
import { adminDb } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";
import { Card, PageTitle } from "@/components/admin/ui";
import { ItemForm } from "@/components/admin/ItemForms";

export const metadata = { title: "Añadir reloj" };

export default async function NuevoPage() {
  await connection();
  await requireAdmin();
  const { data } = await adminDb().from("watches").select("id, brand, model, reference, status").order("published_at", { ascending: false });
  const watches = (data ?? []).map((w) => ({ id: w.id as string, label: `${w.brand} ${w.model} · ${w.reference}${w.status === "sold" ? " (vendido)" : ""}` }));
  return (
    <>
      <Link href="/admin/inventario" className="text-[0.66rem] tracking-[0.2em] uppercase text-stone hover:text-ivory">← Inventario</Link>
      <PageTitle title="Añadir reloj" />
      <Card><ItemForm watches={watches} /></Card>
    </>
  );
}
