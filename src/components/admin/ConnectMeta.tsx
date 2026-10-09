"use client";

import Script from "next/script";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// «Conectar Instagram y Facebook»: inicio de sesión con Facebook (permisos de páginas e Instagram)
// y el servidor guarda la conexión. Si administra varias páginas, se elige cuál.

type FB = {
  init: (o: Record<string, unknown>) => void;
  login: (cb: (r: { authResponse?: { accessToken?: string } }) => void, o: Record<string, unknown>) => void;
};
type PageChoice = { id: string; name: string; instagram: string | null };

export function ConnectMeta({ appId, scopes, configId, label = "Conectar Instagram y Facebook" }: { appId: string; scopes: string[]; configId?: string; label?: string }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<{ kind: "idle" | "working" | "error" | "done"; text?: string }>({ kind: "idle" });
  const [choices, setChoices] = useState<PageChoice[] | null>(null);
  const token = useRef<string | null>(null);

  useEffect(() => {
    const w = window as unknown as { FB?: FB; fbAsyncInit?: () => void };
    w.fbAsyncInit = () => {
      w.FB!.init({ appId, xfbml: false, version: "v26.0" });
      setReady(true);
    };
    if (w.FB) w.fbAsyncInit();
  }, [appId]);

  async function connect(pageId?: string) {
    setStatus({ kind: "working", text: "Conectando…" });
    const res = await fetch("/api/meta/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userToken: token.current, pageId }),
    });
    const j = (await res.json()) as { ok: boolean; error?: string; choose?: PageChoice[]; page?: string; instagram?: string | null; subscribed?: boolean };
    if (j.choose) {
      setChoices(j.choose);
      return setStatus({ kind: "idle" });
    }
    if (!j.ok) return setStatus({ kind: "error", text: j.error ?? "No se pudo conectar." });
    setChoices(null);
    setStatus({
      kind: "done",
      text: `Conectado: ${j.page}${j.instagram ? ` · @${j.instagram}` : " (sin Instagram vinculado)"}${j.subscribed ? "" : " · los mensajes llegarán cuando Meta apruebe la app"}`,
    });
    router.refresh();
  }

  function login() {
    const FB = (window as unknown as { FB?: FB }).FB;
    if (!FB) return;
    FB.login(
      (r) => {
        if (!r.authResponse?.accessToken) return setStatus({ kind: "error", text: "No se completó el inicio de sesión con Facebook." });
        token.current = r.authResponse.accessToken;
        void connect();
      },
      configId ? { config_id: configId } : { scope: scopes.join(","), return_scopes: true }
    );
  }

  return (
    <div>
      <Script src="https://connect.facebook.net/en_US/sdk.js" strategy="afterInteractive" crossOrigin="anonymous" />
      <button
        type="button"
        onClick={login}
        disabled={!ready || status.kind === "working"}
        className="bg-ivory px-5 py-2.5 text-[0.68rem] tracking-[0.22em] uppercase text-ink hover:bg-brass disabled:opacity-60"
      >
        {ready ? label : "Cargando…"}
      </button>
      {choices && (
        <div className="mt-4 space-y-2">
          <p className="text-sm text-stone">Administras varias páginas. ¿Cuál es la de The Heure Society?</p>
          {choices.map((p) => (
            <button key={p.id} type="button" onClick={() => connect(p.id)} className="block w-full border border-line px-4 py-2.5 text-left text-sm hover:border-brass">
              {p.name} {p.instagram ? <span className="text-stone">· @{p.instagram}</span> : <span className="text-stone">· sin Instagram</span>}
            </button>
          ))}
        </div>
      )}
      {status.text && <p className={`mt-3 text-sm ${status.kind === "error" ? "text-red-200/90" : "text-stone"}`}>{status.text}</p>}
    </div>
  );
}

export function SyncButton() {
  const router = useRouter();
  const [state, setState] = useState<{ busy: boolean; text?: string }>({ busy: false });
  async function sync() {
    setState({ busy: true, text: "Actualizando métricas… puede tardar un minuto." });
    const res = await fetch("/api/social/sync", { method: "POST" });
    const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; warnings?: string[] };
    setState({ busy: false, text: j.ok ? `Actualizado${j.warnings?.length ? ` (${j.warnings.length} métricas no disponibles)` : ""}.` : j.error ?? "No se pudo actualizar." });
    router.refresh();
  }
  return (
    <div className="flex items-center gap-3">
      {state.text && <span className="text-xs text-stone">{state.text}</span>}
      <button type="button" onClick={sync} disabled={state.busy} className="border border-line px-4 py-2 text-[0.66rem] tracking-[0.2em] uppercase text-stone hover:border-ivory/40 hover:text-ivory disabled:opacity-50">
        {state.busy ? "Actualizando…" : "Actualizar"}
      </button>
    </div>
  );
}
