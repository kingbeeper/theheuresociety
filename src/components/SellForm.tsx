"use client";

import { useEffect, useRef, useState } from "react";
import type { Dictionary } from "@/app/[lang]/dictionaries";
import { whatsappLink } from "@/lib/watches";

const BRANDS = ["Rolex", "Audemars Piguet", "Patek Philippe", "Richard Mille", "Cartier", "Omega", "Vacheron Constantin"];
const MAX_PHOTOS = 6;
type Condition = "new" | "excellent" | "good" | "fair";

// variant "consign": misma recogida de datos, pero como solicitud de consignación
export function SellForm({ dict, variant = "sell" }: { dict: Dictionary; variant?: "sell" | "consign" }) {
  const t = dict.sell;
  const consign = variant === "consign";
  const priceLabel = consign ? dict.consign.priceLabel : t.price;
  const fileInput = useRef<HTMLInputElement>(null);

  const [brand, setBrand] = useState("");
  const [otherBrand, setOtherBrand] = useState("");
  const [watch, setWatch] = useState({ model: "", reference: "", year: "", price: "" });
  const [condition, setCondition] = useState<Condition | null>(null);
  const [set, setSet] = useState({ box: false, papers: false, service: false });
  const [intent, setIntent] = useState<"sell" | "trade">("sell");
  const [photos, setPhotos] = useState<{ file: File; url: string }[]>([]);
  const [contact, setContact] = useState({ name: "", phone: "", email: "", note: "" });
  const [done, setDone] = useState<{ shared: boolean; link: string } | null>(null);

  // Liberar las vistas previas al salir
  const photosRef = useRef(photos);
  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);
  useEffect(() => () => photosRef.current.forEach((p) => URL.revokeObjectURL(p.url)), []);

  const brandName = brand === "other" ? otherBrand.trim() : brand;
  const missing = [
    !brandName && t.missingBrand,
    !watch.model.trim() && !watch.reference.trim() && t.missingModel,
    !contact.name.trim() && t.missingName,
    !contact.phone.trim() && !contact.email.trim() && t.missingContact,
  ].filter(Boolean) as string[];

  function addPhotos(files: FileList | null) {
    if (!files) return;
    const room = MAX_PHOTOS - photos.length;
    const next = [...files]
      .filter((f) => f.type.startsWith("image/"))
      .slice(0, room)
      .map((file) => ({ file, url: URL.createObjectURL(file) }));
    setPhotos((p) => [...p, ...next]);
  }

  function removePhoto(i: number) {
    setPhotos((p) => {
      URL.revokeObjectURL(p[i].url);
      return p.filter((_, j) => j !== i);
    });
  }

  function message() {
    const included = [set.box && t.box, set.papers && t.papers, set.service && t.service].filter(Boolean).join(", ");
    const lines = consign
      ? [dict.consign.msgTitle, "", `${t.brand}: ${brandName}`]
      : [t.msgTitle, "", `${t.intent}: ${intent === "sell" ? t.intentSell : t.intentTrade}`, `${t.brand}: ${brandName}`];
    if (watch.model.trim()) lines.push(`${t.model.split(" (")[0]}: ${watch.model.trim()}`);
    if (watch.reference.trim()) lines.push(`${t.reference.split(" (")[0]}: ${watch.reference.trim()}`);
    if (watch.year.trim()) lines.push(`${t.year}: ${watch.year.trim()}`);
    if (condition) lines.push(`${t.condition}: ${t.conditions[condition]}`);
    if (included) lines.push(`${t.set}: ${included}`);
    if (watch.price.trim()) lines.push(`${priceLabel.split(" (")[0]}: ${watch.price.trim()}`);
    if (photos.length) lines.push(t.msgPhotos.replace("{n}", String(photos.length)));
    lines.push("", `${t.name}: ${contact.name.trim()}`);
    if (contact.phone.trim()) lines.push(`${t.phone}: ${contact.phone.trim()}`);
    if (contact.email.trim()) lines.push(`${t.email}: ${contact.email.trim()}`);
    if (contact.note.trim()) lines.push(`${t.msgNote}: ${contact.note.trim()}`);
    return lines.join("\n");
  }

  async function submit() {
    if (missing.length) return;
    const text = message();
    const link = whatsappLink(text);
    const files = photos.map((p) => p.file);

    // En el móvil, el menú de compartir envía el texto y las fotos juntos (WhatsApp incluido)
    if (files.length && typeof navigator.canShare === "function" && navigator.canShare({ files })) {
      try {
        await navigator.share({ text, files });
        setDone({ shared: true, link });
        return;
      } catch (e) {
        if ((e as Error).name === "AbortError") return; // el usuario cerró el menú
      }
    }
    window.open(link, "_blank", "noopener");
    setDone({ shared: false, link });
  }

  const field =
    "w-full border border-line bg-forest/60 px-4 py-3 text-sm text-ivory placeholder:text-stone/60 outline-none transition-colors focus:border-brass/70";
  const label = "mb-2 block text-[0.66rem] tracking-[0.22em] uppercase text-stone";
  const option = (on: boolean) =>
    `border px-4 py-2.5 text-sm transition-colors ${on ? "border-brass bg-moss/60 text-ivory" : "border-line text-stone hover:border-ivory/30"}`;

  if (done) {
    return (
      <div className="border border-line bg-forest/60 p-10 text-center">
        <h3 className="font-display text-4xl font-light">{t.doneTitle}</h3>
        <p className="mx-auto mt-5 max-w-md leading-relaxed text-stone">{done.shared ? t.doneShared : t.doneText}</p>
        <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:justify-center">
          {!done.shared && (
            <a href={done.link} target="_blank" rel="noreferrer" className="bg-ivory px-6 py-3.5 text-[0.7rem] tracking-[0.22em] uppercase text-ink hover:bg-brass">
              {t.doneRetry}
            </a>
          )}
          <button
            type="button"
            onClick={() => {
              photos.forEach((p) => URL.revokeObjectURL(p.url));
              setPhotos([]);
              setWatch({ model: "", reference: "", year: "", price: "" });
              setDone(null);
            }}
            className="border border-ivory/30 px-6 py-3.5 text-[0.7rem] tracking-[0.22em] uppercase hover:border-ivory"
          >
            {t.doneNew}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-12">
      {/* Intención (solo en venta) */}
      <div hidden={consign}>
        <span className={label}>{t.intent}</span>
        <div className="flex flex-wrap gap-2">
          <button type="button" aria-pressed={intent === "sell"} className={option(intent === "sell")} onClick={() => setIntent("sell")}>{t.intentSell}</button>
          <button type="button" aria-pressed={intent === "trade"} className={option(intent === "trade")} onClick={() => setIntent("trade")}>{t.intentTrade}</button>
        </div>
      </div>

      {/* Reloj */}
      <fieldset className="space-y-5">
        <legend className="mb-5 font-display text-2xl">{t.watchSection}</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="sm:col-span-2">
            <span className={label}>{t.brand}</span>
            <select className={field} value={brand} onChange={(e) => setBrand(e.target.value)}>
              <option value="">{t.brandPick}</option>
              {BRANDS.map((b) => <option key={b} value={b}>{b}</option>)}
              <option value="other">{t.other}</option>
            </select>
          </label>
          {brand === "other" && (
            <input className={`${field} sm:col-span-2`} placeholder={t.brand} value={otherBrand} onChange={(e) => setOtherBrand(e.target.value)} />
          )}
          <input className={field} placeholder={t.model} value={watch.model} onChange={(e) => setWatch({ ...watch, model: e.target.value })} />
          <input className={field} placeholder={t.reference} value={watch.reference} onChange={(e) => setWatch({ ...watch, reference: e.target.value })} />
          <input className={field} placeholder={t.year} inputMode="numeric" maxLength={4} value={watch.year} onChange={(e) => setWatch({ ...watch, year: e.target.value.replace(/\D/g, "") })} />
          <input className={field} placeholder={priceLabel} value={watch.price} onChange={(e) => setWatch({ ...watch, price: e.target.value })} />
        </div>

        <div>
          <span className={label}>{t.condition}</span>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(t.conditions) as Condition[]).map((c) => (
              <button key={c} type="button" aria-pressed={condition === c} className={option(condition === c)} onClick={() => setCondition(c)}>
                {t.conditions[c]}
              </button>
            ))}
          </div>
        </div>

        <div>
          <span className={label}>{t.set}</span>
          <div className="flex flex-wrap gap-2">
            {(["box", "papers", "service"] as const).map((k) => (
              <button key={k} type="button" aria-pressed={set[k]} className={option(set[k])} onClick={() => setSet((s) => ({ ...s, [k]: !s[k] }))}>
                {set[k] ? "✓ " : ""}{t[k]}
              </button>
            ))}
          </div>
        </div>
      </fieldset>

      {/* Fotos */}
      <div>
        <span className={label}>{t.photos}</span>
        <p className="mb-4 text-sm text-stone">{t.photosHint}</p>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          {photos.map((p, i) => (
            <div key={p.url} className="group relative aspect-square overflow-hidden border border-line">
              {/* eslint-disable-next-line @next/next/no-img-element -- vista previa local (blob:) */}
              <img src={p.url} alt="" className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => removePhoto(i)}
                aria-label={t.remove}
                className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center bg-ink/80 text-xs text-ivory"
              >
                ✕
              </button>
            </div>
          ))}
          {photos.length < MAX_PHOTOS && (
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="flex aspect-square flex-col items-center justify-center gap-1 border border-dashed border-line text-stone transition-colors hover:border-brass/60 hover:text-ivory"
            >
              <span className="text-2xl leading-none">+</span>
              <span className="px-1 text-center text-[0.58rem] tracking-[0.16em] uppercase">{t.addPhotos}</span>
            </button>
          )}
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            addPhotos(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {/* Contacto */}
      <fieldset>
        <legend className="mb-2 font-display text-2xl">{t.contactSection}</legend>
        <p className="mb-5 text-sm text-stone">{t.contactHint}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <input className={`${field} sm:col-span-2`} placeholder={t.name} autoComplete="name" value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} />
          <input className={field} placeholder={t.phone} type="tel" autoComplete="tel" value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} />
          <input className={field} placeholder={t.email} type="email" autoComplete="email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} />
          <textarea className={`${field} min-h-28 resize-y sm:col-span-2`} placeholder={t.note} value={contact.note} onChange={(e) => setContact({ ...contact, note: e.target.value })} />
        </div>
      </fieldset>

      <div>
        <button
          type="button"
          onClick={submit}
          disabled={missing.length > 0}
          className="w-full bg-ivory px-6 py-4 text-[0.72rem] tracking-[0.24em] uppercase text-ink transition-colors enabled:hover:bg-brass disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto sm:px-12"
        >
          {t.submit}
        </button>
        {missing.length > 0 && <p className="mt-3 text-xs text-stone">{t.missing.replace("{fields}", missing.join(", "))}</p>}
        <p className="mt-5 text-xs text-stone/80">{t.privacy}</p>
      </div>
    </div>
  );
}
