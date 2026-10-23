import { tr } from "@/lib/admin-i18n";
import Link from "next/link";
import { connection } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { AUTO_EVERY_DAYS, AUTO_MAX, autoRemindersOn, receivables, waReminderLink } from "@/lib/collections";
import { getDocSettings } from "@/lib/documents";
import { emailReady } from "@/lib/email";
import { KIND_LABEL, paidSoFar } from "@/lib/doc-labels";
import { fmtDate, PageTitle } from "@/components/admin/ui";
import { PendingButton } from "@/components/admin/PendingButton";
import { remindedByWhatsAppAction, remindPaymentAction, toggleAutoRemindersAction } from "../../document-actions";

export const metadata = { title: "Cobros pendientes" };

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const small = "border px-2.5 py-1 text-[0.6rem] tracking-[0.16em] uppercase";

// Cobros pendientes: facturas enviadas sin pagar y proformas con saldo, lo vencido primero, con
// recordatorio al cliente por correo (también automático) o por WhatsApp con el mensaje preparado.
export default async function CollectionsPage() {
  await connection();
  await requireAdmin("documentos");
  const [list, settings, auto] = await Promise.all([receivables(), getDocSettings(), autoRemindersOn()]);
  const rows = [...list].sort((a, b) => (b.overdueDays ?? -1) - (a.overdueDays ?? -1));
  const total = list.reduce((a, d) => a + d.balance, 0);
  const late = list.filter((d) => d.overdueDays);
  const lateTotal = late.reduce((a, d) => a + d.balance, 0);
  const mail = emailReady();

  return (
    <>
      <PageTitle eyebrow="Dinero" title="Cobros pendientes" />
      <div className="mb-6 grid grid-cols-3 gap-3 md:max-w-2xl">
        <div className="border border-line px-4 py-3"><p className="text-[0.6rem] tracking-[0.2em] uppercase text-stone">{tr("Por cobrar")}</p><p className="mt-1 text-xl">{usd(total)}</p><p className="text-xs text-stone">{list.length} {tr("documento(s)")}</p></div>
        <div className="border border-line px-4 py-3"><p className="text-[0.6rem] tracking-[0.2em] uppercase text-stone">{tr("Vencido")}</p><p className={`mt-1 text-xl ${lateTotal ? "text-red-200" : ""}`}>{usd(lateTotal)}</p><p className="text-xs text-stone">{late.length} {tr("documento(s)")}</p></div>
        <div className="border border-line px-4 py-3"><p className="text-[0.6rem] tracking-[0.2em] uppercase text-stone">{tr("Al día")}</p><p className="mt-1 text-xl">{usd(total - lateTotal)}</p></div>
      </div>

      <form action={toggleAutoRemindersAction} className="mb-6 flex flex-wrap items-center gap-3 text-sm text-stone">
        <span>
          {tr("Recordatorio automático por correo a los vencidos:")} <b className={auto ? "text-emerald-200" : "text-stone"}>{auto ? "activado" : "desactivado"}</b>
          {auto && tr(" (cada {d} días, máximo {m} por documento, con el resumen de la mañana)", { d: AUTO_EVERY_DAYS, m: AUTO_MAX })}
          {!mail && tr(" · el correo no está configurado")}
        </span>
        <button className={`${small} border-line hover:text-ivory`}>{auto ? tr("Desactivar") : tr("Activar")}</button>
      </form>
      {!settings.doc_payment_info && (
        <p className="mb-6 text-sm text-amber-200">
          {tr("Añade tus datos de pago (transferencia, Zelle) en")} <Link href="/admin/documentos/ajustes" className="underline">{tr("Documentos → Ajustes")}</Link> {tr("para que salgan en los recordatorios.")}
        </p>
      )}

      {rows.length ? (
        <div className="overflow-x-auto border border-line">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-forest text-left text-[0.62rem] tracking-[0.2em] uppercase text-stone">
              <tr>
                <th className="px-4 py-3 font-normal">{tr("Documento")}</th>
                <th className="px-4 py-3 font-normal">{tr("Cliente")}</th>
                <th className="px-4 py-3 text-right font-normal">{tr("Total")}</th>
                <th className="px-4 py-3 text-right font-normal">{tr("Pagado")}</th>
                <th className="px-4 py-3 text-right font-normal">{tr("Saldo")}</th>
                <th className="px-4 py-3 font-normal">{tr("Vence")}</th>
                <th className="px-4 py-3 font-normal">{tr("Recordatorio")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {rows.map((d) => {
                const wa = waReminderLink(d, settings.doc_payment_info);
                return (
                  <tr key={d.id} className="align-top hover:bg-forest/60">
                    <td className="px-4 py-3">
                      <Link href={`/admin/documentos/${d.id}`} className="hover:text-brass">{tr(KIND_LABEL[d.kind])} {d.number}</Link>
                      <p className="text-xs text-stone">{fmtDate(d.issue_date || d.created_at)}</p>
                    </td>
                    <td className="px-4 py-3">
                      {d.customer_id ? <Link href={`/admin/leads/${d.customer_id}`} className="hover:text-brass">{d.client_name ?? "—"}</Link> : d.client_name ?? "—"}
                      <p className="text-xs text-stone">{[d.client_phone, d.client_email].filter(Boolean).join(" · ")}</p>
                    </td>
                    <td className="px-4 py-3 text-right">{usd(Number(d.total))}</td>
                    <td className="px-4 py-3 text-right text-stone">{paidSoFar(d) ? usd(paidSoFar(d)) : "—"}</td>
                    <td className="px-4 py-3 text-right font-medium">{usd(d.balance)}</td>
                    <td className="px-4 py-3 text-xs">
                      {d.due_date ? fmtDate(d.due_date) : "—"}
                      {d.overdueDays ? <p className="text-red-200">{d.overdueDays} {tr("día(s) de retraso")}</p> : null}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        {d.client_email && mail && (
                          <form action={remindPaymentAction.bind(null, d.id)}>
                            <PendingButton pending={tr("Enviando…")} className={`${small} border-line text-stone hover:text-ivory`}>{tr("✉️ Correo")}</PendingButton>
                          </form>
                        )}
                        {wa && (
                          <>
                            <a href={wa} target="_blank" rel="noreferrer" className={`${small} border-emerald-300/40 text-emerald-200 hover:bg-emerald-300/10`}>{tr("📲 WhatsApp")}</a>
                            <form action={remindedByWhatsAppAction.bind(null, d.id)}>
                              <button title={tr("Anotar que se lo enviaste por WhatsApp")} className={`${small} border-line text-stone hover:text-ivory`}>{tr("✓ Enviado")}</button>
                            </form>
                          </>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-stone">{d.last_reminder_at ? tr("Último: {date} · {n} en total", { date: fmtDate(d.last_reminder_at), n: d.reminder_count ?? 0 }) : tr("Sin recordatorios")}</p>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="border border-line bg-forest/60 p-8 text-center text-sm text-stone">{tr("✅ No hay cobros pendientes.")}</p>
      )}
    </>
  );
}
