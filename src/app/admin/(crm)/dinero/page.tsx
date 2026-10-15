import Link from "next/link";
import { connection } from "next/server";
import { requireUser } from "@/lib/admin-auth";
import { adminDb } from "@/lib/supabase";
import { summarize, type Item } from "@/lib/stock";
import { balanceDue, paidSoFar, type Doc } from "@/lib/doc-labels";
import { todayInMiami } from "@/lib/booking";
import { Card, fieldClass, fmtDate, money, PageTitle, requestTime } from "@/components/admin/ui";
import { EXPENSE_CATEGORY, expensesBetween, sumExpenses } from "@/lib/expenses";
import { addExpenseAction, deleteExpenseAction } from "../../actions";

export const metadata = { title: "Dinero" };

// El dinero del negocio en una pantalla: lo que te deben, lo que tienes de los clientes (anticipos y
// depósitos, que se devuelven si no hay venta), lo que debes a los dueños y cómo va el mes.

const day = (iso: string | null | undefined) => (iso ? fmtDate(`${iso.slice(0, 10)}T12:00:00`) : "—");

export default async function MoneyPage() {
  await connection();
  await requireUser("costos");
  const db = adminDb();
  const now = requestTime();
  const today = todayInMiami(new Date(now));
  const monthStart = `${today.slice(0, 7)}-01`;

  const [{ data: openDocs }, { data: paidDocs }, { data: stock }] = await Promise.all([
    db.from("documents").select("*").in("kind", ["invoice", "proforma", "sourcing"]).eq("status", "sent").order("due_date"),
    db.from("documents").select("*").in("kind", ["invoice", "proforma", "sourcing"]).gte("updated_at", new Date(now - 90 * 86_400_000).toISOString()),
    db.from("inventory_items").select("*"),
  ]);
  const docs = (openDocs ?? []) as Doc[];
  const monthExpenses = await expensesBetween(monthStart).catch(() => []);
  const spentMonth = sumExpenses(monthExpenses);
  const s = summarize((stock ?? []) as Item[], now);

  // Por cobrar: facturas emitidas (el saldo, si tenían anticipo) y saldo de las proformas
  const invoices = docs.filter((d) => d.kind === "invoice").map((d) => ({ d, due: balanceDue(d), late: Boolean(d.due_date && d.due_date < today) }));
  const proformas = docs.filter((d) => d.kind === "proforma").map((d) => ({ d, paid: paidSoFar(d), due: Math.max(0, Number(d.total) - paidSoFar(d)), late: Boolean(d.due_date && d.due_date < today) }));
  const receivable = invoices.reduce((a, x) => a + x.due, 0) + proformas.reduce((a, x) => a + x.due, 0);
  const overdue = [...invoices, ...proformas].filter((x) => x.late).reduce((a, x) => a + x.due, 0);

  // Dinero de clientes que aún no es venta: anticipos de encargos y depósitos de proformas
  const sourcing = docs.filter((d) => d.kind === "sourcing" && d.deposit_paid_at && !d.refunded_at);
  const held = sourcing.reduce((a, d) => a + Number(d.deposit ?? 0), 0) + proformas.reduce((a, x) => a + x.paid, 0);

  // Cobros recientes: facturas pagadas, depósitos de proformas y anticipos de encargos
  type Entry = { date: string; label: string; client: string | null; amount: number; method: string | null; href: string };
  const entries: Entry[] = [];
  for (const d of (paidDocs ?? []) as Doc[]) {
    const href = `/admin/documentos/${d.id}`;
    if (d.kind === "invoice" && d.status === "paid" && d.paid_at) {
      // De una proforma o encargo: solo cuenta el saldo final (los depósitos ya entraron antes)
      const last = d.payments?.length ? d.payments[d.payments.length - 1].amount : balanceDue(d);
      entries.push({ date: d.paid_at, label: `Factura ${d.number}`, client: d.client_name, amount: Number(last), method: d.payment_method, href });
    }
    if (d.kind === "proforma") {
      const pays = d.status === "converted" ? (d.payments ?? []).slice(0, -1) : d.payments ?? []; // el último pago de una convertida es el de la factura
      for (const p of pays) entries.push({ date: p.date, label: `Depósito ${d.number}`, client: d.client_name, amount: Number(p.amount), method: p.method, href });
    }
    if (d.kind === "sourcing" && d.deposit_paid_at) entries.push({ date: d.deposit_paid_at, label: `Anticipo ${d.number}`, client: d.client_name, amount: Number(d.deposit ?? 0), method: d.deposit_method ?? null, href });
  }
  entries.sort((a, b) => b.date.localeCompare(a.date));
  const collectedMonth = entries.filter((e) => e.date >= monthStart).reduce((a, e) => a + e.amount, 0);

  const kpis: { label: string; value: string; sub: string; tone?: string }[] = [
    { label: "Por cobrar", value: money(receivable), sub: `${invoices.length} factura(s) · ${proformas.length} proforma(s)` },
    { label: "Vencido", value: money(overdue), sub: overdue ? "pasada la fecha de pago" : "nada vencido", tone: overdue ? "text-red-200" : undefined },
    { label: "Cobrado este mes", value: money(collectedMonth), sub: "facturas, depósitos y anticipos" },
    { label: "Ventas del mes", value: money(s.salesMonth), sub: `${s.soldMonthCount} reloj(es) · ganancia ${money(s.profitMonth)}` },
    { label: "Gastos del negocio (mes)", value: money(spentMonth), sub: `${monthExpenses.length} gasto(s): renta, marketing…` },
    { label: "Ganancia real del mes", value: money(s.profitMonth - spentMonth), sub: "ganancia de ventas − gastos del negocio", tone: s.profitMonth - spentMonth < 0 ? "text-red-200" : "text-emerald-200" },
    { label: "Anticipos y depósitos", value: money(held), sub: "de clientes; aún no son venta" },
    { label: "Debes a dueños", value: money(s.owedAmount), sub: `${s.owed.length} reloj(es) vendidos en consignación`, tone: s.owed.length ? "text-amber-200" : undefined },
    { label: "Capital en stock", value: money(s.capital), sub: `costo de ${s.inStock - s.consignedCount} reloj(es) propios` },
    { label: "Valor del inventario", value: money(s.stockValue), sub: `${s.inStock} reloj(es) a precio de venta` },
  ];

  const row = "flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line/60 py-2.5 text-sm";
  return (
    <>
      <PageTitle eyebrow="CRM" title="Dinero" action={<Link href="/admin/informes" className="border border-line px-4 py-2 text-[0.66rem] tracking-[0.2em] uppercase text-stone hover:text-ivory">Informe del mes →</Link>} />

      <div className="grid grid-cols-2 gap-px border border-line bg-line lg:grid-cols-5">
        {kpis.map((k) => (
          <div key={k.label} className="bg-forest px-5 py-5">
            <p className={`break-words font-display text-2xl font-light sm:text-3xl ${k.tone ?? ""}`}>{k.value}</p>
            <p className="mt-1 text-[0.6rem] tracking-[0.16em] uppercase text-stone">{k.label}</p>
            <p className="mt-1 text-xs text-stone/80">{k.sub}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card title={`Por cobrar · ${money(receivable)}`}>
          {invoices.length + proformas.length ? (
            <ul>
              {[...proformas.map((x) => ({ ...x, kind: "Proforma", extra: `pagado ${money(x.paid)} de ${money(x.d.total)}` })), ...invoices.map((x) => ({ ...x, kind: "Factura", extra: Number(x.d.deposit ?? 0) > 0 ? `anticipo ${money(x.d.deposit)} descontado` : "" }))]
                .sort((a, b) => (a.d.due_date ?? "9").localeCompare(b.d.due_date ?? "9"))
                .map((x) => (
                  <li key={x.d.id} className={row}>
                    <Link href={`/admin/documentos/${x.d.id}`} className="min-w-0 hover:text-brass">
                      {x.kind} {x.d.number} · {x.d.client_name ?? "—"}
                      {x.extra && <span className="block text-xs text-stone">{x.extra}</span>}
                    </Link>
                    <span className="text-right">
                      <span className="tabular-nums">{money(x.due)}</span>
                      <span className={`block text-xs ${x.late ? "text-red-200" : "text-stone"}`}>{x.late ? "Vencido · " : "Vence "}{day(x.d.due_date)}</span>
                    </span>
                  </li>
                ))}
            </ul>
          ) : (
            <p className="text-sm text-stone">Nada por cobrar.</p>
          )}
        </Card>

        <Card title={`Pagos pendientes a dueños · ${money(s.owedAmount)}`}>
          {s.owed.length ? (
            <ul>
              {s.owed.map((i) => (
                <li key={i.id} className={row}>
                  <Link href={`/admin/inventario/${i.id}`} className="min-w-0 hover:text-brass">
                    {i.sku} · {[i.brand, i.model].filter(Boolean).join(" ")}
                    <span className="block text-xs text-stone">Dueño: {i.supplier_name ?? "—"} · vendido {day(i.sale_date)} por {money(i.sale_price)}</span>
                  </Link>
                  <span className="tabular-nums">{money(i.cost)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-stone">No debes nada a ningún dueño.</p>
          )}
        </Card>

        <Card title={`Anticipos y depósitos de clientes · ${money(held)}`}>
          <p className="mb-2 text-xs text-stone">Dinero recibido que aún no es venta: se aplica a la factura al cerrar, o se devuelve si no hay venta.</p>
          {sourcing.length + proformas.filter((x) => x.paid > 0).length ? (
            <ul>
              {sourcing.map((d) => (
                <li key={d.id} className={row}>
                  <Link href={`/admin/documentos/${d.id}`} className="min-w-0 hover:text-brass">Encargo {d.number} · {d.client_name}<span className="block text-xs text-stone">{d.items[0]?.title}</span></Link>
                  <span className="tabular-nums">{money(d.deposit)}</span>
                </li>
              ))}
              {proformas.filter((x) => x.paid > 0).map((x) => (
                <li key={x.d.id} className={row}>
                  <Link href={`/admin/documentos/${x.d.id}`} className="min-w-0 hover:text-brass">Proforma {x.d.number} · {x.d.client_name}<span className="block text-xs text-stone">{x.d.items[0]?.title}</span></Link>
                  <span className="tabular-nums">{money(x.paid)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-stone">Ninguno ahora mismo.</p>
          )}
        </Card>

        <Card title={`Gastos del negocio este mes · ${money(spentMonth)}`} className="xl:col-span-2">
          <form action={addExpenseAction} className="grid gap-2 sm:grid-cols-[130px_180px_1fr_140px_auto]">
            <input name="spent_on" type="date" defaultValue={today} aria-label="Fecha" className={fieldClass} />
            <select name="category" defaultValue="marketing" aria-label="Categoría" className={fieldClass}>
              {Object.entries(EXPENSE_CATEGORY).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <input name="note" placeholder="Detalle (ej. anuncios de Instagram de octubre)" aria-label="Detalle" className={fieldClass} />
            <input name="amount" inputMode="decimal" required placeholder="Importe $" aria-label="Importe" className={fieldClass} />
            <button className="border border-line px-4 py-2 text-[0.66rem] tracking-[0.2em] uppercase text-stone hover:text-ivory">Añadir</button>
          </form>
          <p className="mt-2 text-xs text-stone">Gastos que no son de un reloj concreto (los del reloj, como servicio o pulido, van en su ficha). También desde Telegram: 💵 Costos y gastos → 🏢 Gasto del negocio.</p>
          {monthExpenses.length > 0 && (
            <ul className="mt-3">
              {monthExpenses.map((e) => (
                <li key={e.id} className={row}>
                  <span className="min-w-0">{EXPENSE_CATEGORY[e.category] ?? e.category}{e.note ? ` · ${e.note}` : ""}<span className="block text-xs text-stone">{day(e.spent_on)}{e.created_by ? ` · ${e.created_by.split("@")[0]}` : ""}</span></span>
                  <span className="flex items-center gap-3">
                    <span className="tabular-nums">{money(e.amount)}</span>
                    <form action={deleteExpenseAction.bind(null, e.id)}><button className="text-xs text-stone underline hover:text-red-200">Quitar</button></form>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Cobros recientes (90 días)">
          {entries.length ? (
            <ul>
              {entries.slice(0, 20).map((e, k) => (
                <li key={k} className={row}>
                  <Link href={e.href} className="min-w-0 hover:text-brass">{e.label} · {e.client ?? "—"}<span className="block text-xs text-stone">{day(e.date)}{e.method ? ` · ${e.method}` : ""}</span></Link>
                  <span className="tabular-nums text-emerald-200">+{money(e.amount)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-stone">Sin cobros en los últimos 90 días.</p>
          )}
        </Card>
      </div>
    </>
  );
}
