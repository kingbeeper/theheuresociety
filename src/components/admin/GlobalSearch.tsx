"use client";


import { useTr } from "@/components/admin/AdminLang";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

// Buscador global del CRM: Ctrl/Cmd + K (o el botón del menú). Escribe un nombre, teléfono, serial,
// número de documento o referencia; ↑ ↓ para moverte y Enter para abrir.

type Result = { group: string; title: string; sub: string; href: string };

export function GlobalSearch() {
  const tr = useTr();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  // Atajo de teclado
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 0);
  }, [open]);

  // Búsqueda mientras escribes (espera a que pares un momento)
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      setLoading(true);
      fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : { results: [] }))
        .then((j: { results: Result[] }) => {
          setResults(j.results);
          setActive(0);
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    }, 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  const shown = q.trim().length < 2 ? [] : results;
  const go = (r: Result) => {
    setOpen(false);
    setQ("");
    setResults([]);
    router.push(r.href);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mx-3 mb-2 flex w-[calc(100%-1.5rem)] items-center gap-2 border border-line px-3 py-2 text-left text-xs text-stone hover:text-ivory md:mx-4 md:w-[calc(100%-2rem)]"
      >
        <Search aria-hidden className="h-3.5 w-3.5" strokeWidth={1.5} />
        <span className="flex-1">{tr("Buscar…")}</span>
        <kbd className="hidden text-[0.6rem] tracking-wider text-stone/70 md:inline">{tr("Ctrl K")}</kbd>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-ink/70 px-4 pt-[12vh]" onClick={() => setOpen(false)}>
          <div role="dialog" aria-label={tr("Buscar en el CRM")} className="w-full max-w-xl border border-line bg-forest shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 border-b border-line px-4">
              <Search aria-hidden className="h-4 w-4 shrink-0 text-brass" strokeWidth={1.5} />
              <input
                ref={input}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setActive((a) => Math.min(a + 1, shown.length - 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setActive((a) => Math.max(a - 1, 0));
                  } else if (e.key === "Enter" && shown[active]) {
                    go(shown[active]);
                  }
                }}
                placeholder={tr("Cliente, teléfono, serial, factura, referencia…")}
                className="w-full bg-transparent py-4 text-sm text-ivory outline-none placeholder:text-stone/60"
              />
              {loading && <span className="text-xs text-stone">…</span>}
            </div>
            <div className="max-h-[60vh] overflow-y-auto">
              {q.trim().length >= 2 && !loading && !shown.length && <p className="px-4 py-6 text-sm text-stone">{tr("Sin resultados.")}</p>}
              {shown.map((r, i) => (
                <div key={`${r.href}-${i}`}>
                  {(i === 0 || shown[i - 1].group !== r.group) && <p className="px-4 pt-3 pb-1 text-[0.58rem] tracking-[0.2em] uppercase text-brass">{r.group}</p>}
                  <button
                    type="button"
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(r)}
                    className={`block w-full px-4 py-2 text-left ${i === active ? "bg-moss" : ""}`}
                  >
                    <span className="block truncate text-sm">{r.title}</span>
                    {r.sub && <span className="block truncate text-xs text-stone">{r.sub}</span>}
                  </button>
                </div>
              ))}
            </div>
            <p className="border-t border-line px-4 py-2 text-[0.6rem] tracking-wider text-stone/70">{tr("↑ ↓ para moverte · Enter para abrir · Esc para cerrar")}</p>
          </div>
        </div>
      )}
    </>
  );
}
