import { connection } from "next/server";
import { requireUser } from "@/lib/admin-auth";
import { can, ROLE_LABEL, SECTIONS, type Section } from "@/lib/crm-perms";
import { Card, PageTitle } from "@/components/admin/ui";
import { PasswordForm } from "@/components/admin/UserForms";

export const metadata = { title: "Mi cuenta" };

export default async function AccountPage({ searchParams }: PageProps<"/admin/cuenta">) {
  await connection();
  const user = await requireUser();
  const welcome = Boolean((await searchParams).bienvenida);
  const sections = (Object.keys(SECTIONS) as Section[]).filter((s) => can(user, s));

  return (
    <>
      <PageTitle eyebrow="CRM" title="Mi cuenta" />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Contraseña">
          <PasswordForm welcome={welcome} />
        </Card>
        <Card title="Acceso">
          <p className="text-sm">{user.name ?? user.email}</p>
          <p className="text-xs text-stone">{user.email} · {ROLE_LABEL[user.role]}</p>
          <ul className="mt-4 space-y-1 text-sm text-stone">
            {sections.map((s) => <li key={s}>✓ {SECTIONS[s]}</li>)}
          </ul>
        </Card>
      </div>
    </>
  );
}
