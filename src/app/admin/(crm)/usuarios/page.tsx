import { connection } from "next/server";
import { ownerEmails, requireUser } from "@/lib/admin-auth";
import { adminDb } from "@/lib/supabase";
import { ROLE_LABEL, SECTIONS, type Section } from "@/lib/crm-perms";
import { Card, fmtDate, PageTitle } from "@/components/admin/ui";
import { AddUserForm, EditUserForm, NewLinkButton } from "@/components/admin/UserForms";
import { setUserActive } from "../../user-actions";

export const metadata = { title: "Usuarios" };

export default async function UsersPage() {
  await connection();
  const me = await requireUser("usuarios");
  const { data, error } = await adminDb().from("crm_users").select("*").order("created_at");
  const users = data ?? [];

  return (
    <>
      <PageTitle eyebrow="CRM" title="Usuarios y permisos" />
      {error && <p className="mb-6 border border-amber-300/40 bg-amber-300/5 p-4 text-sm">Falta ejecutar la migración <code>2026-10-17-users.sql</code> en Supabase.</p>}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card title="Superadministradores">
            <ul className="space-y-1 text-sm">
              {ownerEmails().map((e) => <li key={e}>{e} <span className="text-xs text-stone">· todo, incluido dar y quitar accesos</span></li>)}
            </ul>
            <p className="mt-3 text-xs text-stone">Se configuran en <code>CRM_ADMIN_EMAILS</code> (no se pueden quitar desde aquí).</p>
          </Card>

          {users.map((u) => (
            <Card key={u.email} title={`${u.name ?? u.email}${u.active ? "" : " · sin acceso"}`}>
              <p className="mb-4 text-xs text-stone">
                {u.email} · {u.role === "admin" ? ROLE_LABEL.admin : (u.permissions as Section[]).map((p) => SECTIONS[p]).join(" · ") || "sin permisos"}
                {" · desde "}{fmtDate(u.created_at as string)}
              </p>
              {u.active ? (
                <>
                  <EditUserForm email={u.email} name={u.name} role={u.role} permissions={u.permissions as Section[]} />
                  <div className="mt-4 flex flex-wrap items-start gap-4 border-t border-line pt-4">
                    <NewLinkButton email={u.email} />
                    {u.email !== me.email && (
                      <form action={setUserActive.bind(null, u.email, false)}>
                        <button className="text-[0.62rem] tracking-[0.18em] uppercase text-red-200/80 hover:text-red-200">Quitar acceso</button>
                      </form>
                    )}
                  </div>
                </>
              ) : (
                <form action={setUserActive.bind(null, u.email, true)}>
                  <button className="text-[0.62rem] tracking-[0.18em] uppercase text-brass hover:text-ivory">Devolver el acceso</button>
                </form>
              )}
            </Card>
          ))}
        </div>

        <Card title="Dar acceso a alguien">
          <AddUserForm />
          <p className="mt-4 text-xs text-stone">
            Al guardar se genera un enlace de un solo uso: envíaselo y, al abrirlo, la persona elige su contraseña. Para quitarle el acceso, «Quitar acceso»
            (deja de entrar al momento). Lo que hace cada usuario queda en el historial con su correo.
          </p>
        </Card>
      </div>
    </>
  );
}
