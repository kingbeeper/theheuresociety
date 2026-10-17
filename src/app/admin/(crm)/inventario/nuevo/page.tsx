import { tr } from "@/lib/admin-i18n";
import Link from "next/link";
import { connection } from "next/server";
import { adminDb } from "@/lib/supabase";
import { requireUser } from "@/lib/admin-auth";
import { can } from "@/lib/crm-perms";
import { Card, PageTitle } from "@/components/admin/ui";
import { ItemForm } from "@/components/admin/ItemForms";

export const metadata = { title: "Añadir reloj" };

export default async function NuevoPage({ searchParams }: PageProps<"/admin/inventario/nuevo">) {
  await connection();
  const user = await requireUser("inventario");
  // Desde Telegram (tarjeta de garantía leída): el alta llega rellenada
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).slice(0, 80) : undefined);
  const prefill = { brand: one("marca"), model: one("modelo"), reference: one("ref"), serial: one("serial"), papers_date: one("papeles"), comes_with: one("serial") ? "Papers" : undefined };
  const { data } = await adminDb().from("watches").select("id, brand, model, reference, status").order("published_at", { ascending: false });
  const watches = (data ?? []).map((w) => ({ id: w.id as string, label: `${w.brand} ${w.model} · ${w.reference}${w.status === "sold" ? " (vendido)" : ""}` }));
  return (
    <>
      <Link href="/admin/inventario" className="text-[0.66rem] tracking-[0.2em] uppercase text-stone hover:text-ivory">{tr("← Inventario")}</Link>
      <PageTitle title="Añadir reloj" />
      <Card><ItemForm watches={watches} showCosts={can(user, "costos")} prefill={prefill} /></Card>
    </>
  );
}
