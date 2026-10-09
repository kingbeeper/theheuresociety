import Link from "next/link";
import { SOURCE_LABEL, STAGE_LABEL, type Stage } from "@/lib/crm";

// Piezas pequeñas del CRM

const STAGE_STYLE: Record<Stage, string> = {
  new: "border-brass/60 text-brass",
  contacted: "border-sky-300/40 text-sky-200",
  qualified: "border-violet-300/40 text-violet-200",
  appointment: "border-amber-300/50 text-amber-200",
  negotiating: "border-orange-300/50 text-orange-200",
  won: "border-emerald-300/50 bg-emerald-400/10 text-emerald-200",
  lost: "border-line text-stone/60",
};

export function StageBadge({ stage }: { stage: Stage }) {
  return (
    <span className={`inline-block whitespace-nowrap border px-2 py-0.5 text-[0.62rem] tracking-[0.16em] uppercase ${STAGE_STYLE[stage]}`}>
      {STAGE_LABEL[stage]}
    </span>
  );
}

export function SourceTag({ source }: { source: string }) {
  return <span className="whitespace-nowrap text-xs text-stone">{SOURCE_LABEL[source] ?? source}</span>;
}

export function PageTitle({ eyebrow, title, action }: { eyebrow?: string; title: string; action?: React.ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1 className="mt-2 font-display text-3xl font-light sm:text-4xl">{title}</h1>
      </div>
      {action}
    </div>
  );
}

export function Card({ title, children, href, className = "" }: { title?: string; children: React.ReactNode; href?: string; className?: string }) {
  return (
    <section className={`border border-line bg-forest/60 p-5 ${className}`}>
      {title && (
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[0.66rem] tracking-[0.24em] uppercase text-stone">{title}</h2>
          {href && (
            <Link href={href} className="text-[0.62rem] tracking-[0.2em] uppercase text-brass hover:text-ivory">
              Ver todo →
            </Link>
          )}
        </div>
      )}
      {children}
    </section>
  );
}

// Fechas en hora de Miami
const TZ = "America/New_York";
export const fmtDateTime = (iso: string) =>
  new Intl.DateTimeFormat("es-ES", { timeZone: TZ, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
export const fmtDate = (iso: string) => new Intl.DateTimeFormat("es-ES", { timeZone: TZ, day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));

export function ago(iso: string, now: number) {
  const m = Math.round((now - new Date(iso).getTime()) / 60000);
  if (m < 60) return `hace ${Math.max(m, 1)} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return d < 30 ? `hace ${d} d` : fmtDate(iso);
}

export const money = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

export const fieldClass =
  "w-full border border-line bg-ink/60 px-3 py-2.5 text-sm text-ivory placeholder:text-stone/50 outline-none transition-colors focus:border-brass/70";
export const labelClass = "mb-1.5 block text-[0.62rem] tracking-[0.22em] uppercase text-stone";
export const buttonClass =
  "bg-ivory px-5 py-2.5 text-[0.68rem] tracking-[0.22em] uppercase text-ink transition-colors hover:bg-brass disabled:opacity-60";
export const ghostButtonClass =
  "border border-line px-4 py-2 text-[0.66rem] tracking-[0.2em] uppercase text-stone transition-colors hover:border-ivory/40 hover:text-ivory";

// Hora de la petición (las páginas del CRM se generan en cada visita)
export const requestTime = () => Date.now();
