import Link from "next/link";
import { connection } from "next/server";
import { requireUser } from "@/lib/admin-auth";
import { adminDb } from "@/lib/supabase";
import { can } from "@/lib/crm-perms";
import { openTasks } from "@/lib/staff-tasks";
import { team } from "@/lib/team";
import { todayInMiami } from "@/lib/booking";
import { buttonClass, Card, fieldClass, fmtDate, labelClass, PageTitle, requestTime } from "@/components/admin/ui";
import { completeStaffTaskAction, createStaffTask } from "../../task-actions";

export const metadata = { title: "Tareas" };

export default async function TasksPage({ searchParams }: PageProps<"/admin/tareas">) {
  await connection();
  const user = await requireUser();
  const sp = await searchParams;
  const manager = can(user, "usuarios");
  const view = manager && sp.ver === "todas" ? "all" : "mine";
  const today = todayInMiami(new Date(requestTime()));
  const [tasks, members, customers, items] = await Promise.all([
    openTasks(view === "mine" ? user.email : undefined),
    team(),
    adminDb().from("customers").select("id, name").order("last_activity_at", { ascending: false }).limit(300),
    adminDb().from("inventory_items").select("id, sku, brand, model").in("status", ["in_stock", "reserved"]).order("sku"),
  ]);
  const name = (email: string) => members.find((m) => m.email === email)?.name ?? email;
  const customerName = new Map((customers.data ?? []).map((c) => [c.id as string, c.name as string | null]));
  const itemName = new Map((items.data ?? []).map((i) => [i.id as string, `${i.sku} ${i.brand} ${i.model ?? ""}`]));

  return (
    <>
      <PageTitle eyebrow="CRM" title="Tareas" />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Card title={view === "all" ? `Todas las tareas · ${tasks.length}` : `Mis tareas · ${tasks.length}`}>
          {manager && (
            <div className="mb-4 flex gap-3 text-[0.62rem] tracking-[0.18em] uppercase">
              <Link href="/admin/tareas" className={view === "mine" ? "text-brass" : "text-stone hover:text-ivory"}>Mías</Link>
              <Link href="/admin/tareas?ver=todas" className={view === "all" ? "text-brass" : "text-stone hover:text-ivory"}>De todo el equipo</Link>
            </div>
          )}
          {tasks.length ? (
            <ul className="divide-y divide-line/60">
              {tasks.map((t) => {
                const late = t.due_date && t.due_date < today;
                return (
                  <li key={t.id} className="flex items-start justify-between gap-3 py-3">
                    <div className="min-w-0 text-sm">
                      <p>{t.title}</p>
                      <p className={`text-xs ${late ? "text-red-200" : "text-stone"}`}>
                        {t.due_date ? `${late ? "Vencida · " : ""}${fmtDate(`${t.due_date}T12:00:00`)}` : "Sin fecha"}
                        {view === "all" && ` · ${name(t.assignee)}`}
                        {t.created_by && t.created_by !== t.assignee && ` · de ${name(t.created_by)}`}
                      </p>
                      {t.notes && <p className="mt-1 text-xs text-stone">{t.notes}</p>}
                      <div className="mt-1 flex flex-wrap gap-3 text-xs">
                        {t.customer_id && <Link href={`/admin/leads/${t.customer_id}`} className="text-brass hover:text-ivory">👤 {customerName.get(t.customer_id) ?? "Cliente"}</Link>}
                        {t.item_id && <Link href={`/admin/inventario/${t.item_id}`} className="text-brass hover:text-ivory">⌚ {itemName.get(t.item_id) ?? "Reloj"}</Link>}
                      </div>
                    </div>
                    <form action={completeStaffTaskAction.bind(null, t.id)}>
                      <button className="whitespace-nowrap border border-line px-3 py-1.5 text-[0.62rem] tracking-[0.18em] uppercase text-stone hover:text-ivory">✓ Hecha</button>
                    </form>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-stone">Nada pendiente. 🎉</p>
          )}
        </Card>

        <Card title="Nueva tarea">
          <form action={createStaffTask} className="grid gap-4">
            <label><span className={labelClass}>Qué hay que hacer *</span><input name="title" required placeholder="Llamar a Juan para la cita del viernes" className={fieldClass} /></label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label>
                <span className={labelClass}>Para</span>
                <select name="assignee" defaultValue={user.email} className={fieldClass}>
                  {members.map((m) => <option key={m.email} value={m.email}>{m.name ?? m.email}{m.email === user.email ? " (yo)" : ""}</option>)}
                </select>
              </label>
              <label><span className={labelClass}>Para cuándo</span><input name="due_date" type="date" defaultValue={today} className={fieldClass} /></label>
              <label>
                <span className={labelClass}>Cliente (opcional)</span>
                <select name="customer_id" defaultValue={typeof sp.cliente === "string" ? sp.cliente : ""} className={fieldClass}>
                  <option value="">—</option>
                  {(customers.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name ?? "Sin nombre"}</option>)}
                </select>
              </label>
              <label>
                <span className={labelClass}>Reloj (opcional)</span>
                <select name="item_id" defaultValue={typeof sp.reloj === "string" ? sp.reloj : ""} className={fieldClass}>
                  <option value="">—</option>
                  {(items.data ?? []).map((i) => <option key={i.id} value={i.id}>{i.sku} · {i.brand} {i.model ?? ""}</option>)}
                </select>
              </label>
            </div>
            <label><span className={labelClass}>Notas</span><textarea name="notes" rows={2} className={fieldClass} /></label>
            <button className={`${buttonClass} justify-self-start`}>Crear tarea</button>
            <p className="text-xs text-stone">Si la persona tiene su ID de Telegram en Usuarios, le llega el aviso con un botón para marcarla hecha.</p>
          </form>
        </Card>
      </div>
    </>
  );
}
