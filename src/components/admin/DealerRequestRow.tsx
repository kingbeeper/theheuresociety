import { tr } from "@/lib/admin-i18n";
import { answerDealerAction } from "@/app/admin/actions";
import { dealerMessage, REQUEST_STATUS, waLink, type Dealer, type DealerRequest } from "@/lib/dealers";

const btn = "border px-2 py-1 text-[0.6rem] tracking-[0.14em] uppercase";
const money = (n: number | string) => `$${Math.round(Number(n)).toLocaleString("en-US")}`;

// Una petición a un dealer: estado, botón de WhatsApp con el mensaje y el formulario para anotar su respuesta
export function DealerRequestRow({ r, dealer, title }: { r: DealerRequest; dealer?: Pick<Dealer, "name" | "wa_id" | "phone">; title: React.ReactNode }) {
  const wa = dealer ? waLink(dealer, dealerMessage(r.query, r.budget ? Number(r.budget) : null, dealer.name)) : null;
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm">
      <div className="min-w-0">
        <p className="truncate">
          {title}{" "}
          <span className={`text-xs ${r.status === "no" ? "text-stone" : r.status === "asked" ? "text-amber-200" : "text-emerald-200"}`}>
            · {tr(REQUEST_STATUS[r.status])}{r.price ? ` · ${money(r.price)}` : ""}
          </span>
        </p>
        {r.note && <p className="text-xs text-stone">{r.note}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {wa && <a href={wa} target="_blank" rel="noreferrer" className={`${btn} border-emerald-300/40 text-emerald-200 hover:bg-emerald-300/10`}>{tr("📲 WhatsApp")}</a>}
        <form action={answerDealerAction.bind(null, r.id)} className="flex items-center gap-1.5">
          <input name="price" inputMode="decimal" placeholder={tr("Precio $")} defaultValue={r.price ?? ""} className="w-24 border border-line bg-ink/60 px-2 py-1 text-xs" />
          <input name="note" placeholder={tr("Nota (año, set…)")} defaultValue={r.note ?? ""} className="w-36 border border-line bg-ink/60 px-2 py-1 text-xs" />
          <button name="status" value="has" className={`${btn} border-line text-stone hover:text-ivory`}>{tr("La tiene")}</button>
          <button name="status" value="no" className={`${btn} border-line text-stone hover:text-ivory`}>{tr("No")}</button>
        </form>
      </div>
    </li>
  );
}
