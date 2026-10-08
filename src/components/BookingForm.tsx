"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/app/[lang]/dictionaries";
import { booking } from "@/lib/site";
import { whatsappLink } from "@/lib/watches";

type Piece = { slug: string; brand: string; model: string; reference: string; image?: string };
type Kind = "office" | "video";

const toKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function BookingForm({ lang, dict, pieces }: { lang: Locale; dict: Dictionary; pieces: Piece[] }) {
  const t = dict.booking;
  const params = useSearchParams();
  const initialType = params.get("type");
  const initialWatch = params.get("watch");

  const [kind, setKind] = useState<Kind | null>(
    initialType === "office" || initialType === "video" ? initialType : null
  );
  const [selected, setSelected] = useState<string[]>(
    initialWatch && pieces.some((p) => p.slug === initialWatch) ? [initialWatch] : []
  );
  const [day, setDay] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", phone: "", email: "", note: "" });
  const [sentLink, setSentLink] = useState<string | null>(null);

  const locale = lang === "es" ? "es" : "en";

  // Próximos días a partir de mañana (este componente se renderiza solo en el navegador)
  const days = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return Array.from({ length: booking.daysAhead }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i + 1);
      return { key: toKey(d), date: d, slots: booking.slots[d.getDay()] ?? [] };
    });
  }, []);

  const dayInfo = days.find((d) => d.key === day);
  const fmtDay = (d: Date, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, opts).format(d);
  const whenLabel =
    dayInfo && time
      ? (([first, ...rest]) => first.toUpperCase() + rest.join(""))(
          `${fmtDay(dayInfo.date, { weekday: "long", day: "numeric", month: "long" })}, ${time}`
        )
      : null;
  const chosen = pieces.filter((p) => selected.includes(p.slug));

  const missing = [
    !kind && t.missingType,
    !whenLabel && t.missingSlot,
    !form.name.trim() && t.missingName,
    !form.phone.trim() && !form.email.trim() && t.missingContact,
  ].filter(Boolean) as string[];

  function submit() {
    if (missing.length || !kind || !whenLabel) return;
    const lines = [
      t.msgTitle,
      "",
      `${t.type}: ${kind === "office" ? t.msgOffice : t.msgVideo}`,
      `${t.when}: ${whenLabel}`,
      `${t.pieces}: ${chosen.length ? chosen.map((p) => `${p.brand} ${p.model} (${p.reference})`).join(", ") : t.none}`,
      "",
      `${t.name}: ${form.name.trim()}`,
    ];
    if (form.phone.trim()) lines.push(`${t.phone}: ${form.phone.trim()}`);
    if (form.email.trim()) lines.push(`${t.email}: ${form.email.trim()}`);
    if (form.note.trim()) lines.push(`${t.msgNote}: ${form.note.trim()}`);
    const link = whatsappLink(lines.join("\n"));
    window.open(link, "_blank", "noopener");
    setSentLink(link);
  }

  const heading = (n: string, label: string, hint?: string) => (
    <div className="mb-6">
      <p className="font-display text-xl text-brass/80">{n}</p>
      <h2 className="mt-1 text-[0.78rem] tracking-[0.24em] uppercase">{label}</h2>
      {hint && <p className="mt-2 text-sm text-stone">{hint}</p>}
    </div>
  );
  const field =
    "w-full border border-line bg-forest/60 px-4 py-3 text-sm text-ivory placeholder:text-stone/60 outline-none transition-colors focus:border-brass/70";

  if (sentLink) {
    return (
      <div className="mx-auto max-w-xl border border-line bg-forest/60 p-10 text-center">
        <p className="eyebrow">{t.summary}</p>
        <h2 className="mt-4 font-display text-4xl font-light">{t.doneTitle}</h2>
        <p className="mt-5 leading-relaxed text-stone">{t.doneText}</p>
        <p className="mt-6 text-sm">
          {kind === "office" ? t.office : t.video} · {whenLabel}
        </p>
        <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <a href={sentLink} target="_blank" rel="noreferrer" className="bg-ivory px-6 py-3.5 text-[0.7rem] tracking-[0.22em] uppercase text-ink hover:bg-brass">
            {t.doneRetry}
          </a>
          <button
            type="button"
            onClick={() => { setSentLink(null); setDay(null); setTime(null); }}
            className="border border-ivory/30 px-6 py-3.5 text-[0.7rem] tracking-[0.22em] uppercase hover:border-ivory"
          >
            {t.doneNew}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-16 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-20">
      <div className="min-w-0 space-y-16">
        {/* 01 · Tipo */}
        <section>
          {heading("01", t.step1)}
          <div className="grid gap-4 sm:grid-cols-2">
            {(["office", "video"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                aria-pressed={kind === k}
                className={`border p-6 text-left transition-colors ${
                  kind === k ? "border-brass bg-moss/60" : "border-line hover:border-ivory/30"
                }`}
              >
                <span className="flex items-center justify-between">
                  <span className="font-display text-2xl">{k === "office" ? t.office : t.video}</span>
                  <span className={`h-3 w-3 rounded-full border ${kind === k ? "border-brass bg-brass" : "border-stone"}`} />
                </span>
                <span className="mt-3 block text-sm leading-relaxed text-stone">
                  {k === "office" ? t.officeText : t.videoText}
                </span>
              </button>
            ))}
          </div>
        </section>

        {/* 02 · Piezas */}
        <section>
          {heading("02", t.step2, t.step2Hint)}
          <div className="grid gap-3 min-[420px]:grid-cols-2 sm:grid-cols-3">
            {pieces.map((p) => {
              const on = selected.includes(p.slug);
              return (
                <button
                  key={p.slug}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setSelected((s) => (on ? s.filter((x) => x !== p.slug) : [...s, p.slug]))}
                  className={`group flex items-center gap-3 border p-2.5 text-left transition-colors ${
                    on ? "border-brass bg-moss/60" : "border-line hover:border-ivory/30"
                  }`}
                >
                  <span className="relative h-14 w-11 shrink-0 overflow-hidden bg-moss">
                    {p.image && <Image src={p.image} alt="" fill sizes="44px" className="object-cover" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[0.66rem] tracking-[0.2em] uppercase text-stone">{p.brand}</span>
                    <span className="line-clamp-2 block font-display text-base leading-tight">{p.model}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {/* 03 · Día y hora */}
        <section>
          {heading("03", t.step3, t.duration.replace("{n}", String(booking.durationMinutes)))}
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2">
            {days.map((d) => {
              const closed = d.slots.length === 0;
              const on = d.key === day;
              return (
                <button
                  key={d.key}
                  type="button"
                  disabled={closed}
                  onClick={() => { setDay(d.key); setTime(null); }}
                  className={`flex w-[4.25rem] shrink-0 flex-col items-center border py-3 transition-colors ${
                    on ? "border-brass bg-brass text-ink" : closed ? "border-line/50 text-stone/40" : "border-line hover:border-ivory/40"
                  }`}
                >
                  <span className="text-[0.66rem] tracking-[0.18em] uppercase">{fmtDay(d.date, { weekday: "short" })}</span>
                  <span className="mt-1 font-display text-2xl leading-none">{d.date.getDate()}</span>
                  <span className="mt-1 text-[0.66rem] tracking-[0.14em] uppercase">
                    {closed ? t.closed : fmtDay(d.date, { month: "short" })}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-6">
            {dayInfo ? (
              <div className="flex flex-wrap gap-2">
                {dayInfo.slots.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setTime(s)}
                    className={`min-w-20 border px-4 py-2.5 text-sm transition-colors ${
                      time === s ? "border-brass bg-brass text-ink" : "border-line hover:border-ivory/40"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-stone">{t.pickDay}</p>
            )}
          </div>
        </section>

        {/* 04 · Datos */}
        <section>
          {heading("04", t.step4, t.contactHint)}
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="sm:col-span-2">
              <span className="sr-only">{t.name}</span>
              <input className={field} placeholder={t.name} autoComplete="name" value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <label>
              <span className="sr-only">{t.phone}</span>
              <input className={field} placeholder={t.phone} type="tel" autoComplete="tel" value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </label>
            <label>
              <span className="sr-only">{t.email}</span>
              <input className={field} placeholder={t.email} type="email" autoComplete="email" value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </label>
            <label className="sm:col-span-2">
              <span className="sr-only">{t.note}</span>
              <textarea className={`${field} min-h-28 resize-y`} placeholder={t.note} value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })} />
            </label>
          </div>
        </section>
      </div>

      {/* Resumen */}
      <aside className="lg:sticky lg:top-8 lg:self-start">
        <div className="border border-line bg-forest/70 p-7">
          <p className="eyebrow">{t.summary}</p>
          <dl className="mt-6 space-y-5 text-sm">
            <div>
              <dt className="text-[0.66rem] tracking-[0.22em] uppercase text-stone">{t.type}</dt>
              <dd className="mt-1">{kind ? (kind === "office" ? t.office : t.video) : "—"}</dd>
            </div>
            <div>
              <dt className="text-[0.66rem] tracking-[0.22em] uppercase text-stone">{t.when}</dt>
              <dd className="mt-1">{whenLabel ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-[0.66rem] tracking-[0.22em] uppercase text-stone">{t.pieces}</dt>
              <dd className="mt-1 space-y-1">
                {chosen.length ? chosen.map((p) => <p key={p.slug}>{p.brand} {p.model}</p>) : <p className="text-stone">{t.none}</p>}
              </dd>
            </div>
          </dl>

          <button
            type="button"
            onClick={submit}
            disabled={missing.length > 0}
            className="mt-8 w-full bg-ivory px-5 py-4 text-[0.7rem] tracking-[0.22em] uppercase text-ink transition-colors enabled:hover:bg-brass disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t.submit}
          </button>
          {missing.length > 0 && (
            <p className="mt-3 text-xs text-stone">{t.missing.replace("{fields}", missing.join(", "))}</p>
          )}
          <p className="mt-6 border-t border-line pt-5 text-xs leading-relaxed text-stone/80">{t.privacy}</p>
        </div>
      </aside>
    </div>
  );
}
