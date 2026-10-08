"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";

// Botón de conexión de Meta (Embedded Signup). Meta devuelve un código de un solo uso (caduca en
// 30 s) y, por otro canal, los ids de la cuenta; en cuanto llegan los dos se envían al servidor.

type FB = { init: (o: Record<string, unknown>) => void; login: (cb: (r: { authResponse?: { code?: string } }) => void, o: Record<string, unknown>) => void };
declare global {
  interface Window {
    FB?: FB;
    fbAsyncInit?: () => void;
  }
}

type Status = { state: "idle" | "waiting" | "working" | "done" | "error"; lines: string[] };

export function WhatsAppConnect({ appId, configId, onboardKey }: { appId: string; configId: string; onboardKey: string }) {
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<Status>({ state: "idle", lines: [] });
  const session = useRef<{ code?: string; wabaId?: string; phoneNumberId?: string; sent?: boolean }>({});

  async function trySend() {
    const s = session.current;
    if (s.sent || !s.code || !s.wabaId) return;
    s.sent = true;
    setStatus({ state: "working", lines: ["Conectando con WhatsApp…"] });
    const res = await fetch("/api/whatsapp/onboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: onboardKey, code: s.code, wabaId: s.wabaId, phoneNumberId: s.phoneNumberId }),
    });
    const json = (await res.json()) as { ok: boolean; steps?: string[]; error?: string };
    setStatus({ state: json.ok ? "done" : "error", lines: [...(json.steps ?? []), ...(json.error ? [json.error] : [])] });
  }

  useEffect(() => {
    window.fbAsyncInit = () => {
      window.FB!.init({ appId, autoLogAppEvents: true, xfbml: true, version: "v26.0" });
      setReady(true);
    };
    if (window.FB) window.fbAsyncInit();

    // Ids de la cuenta (registro de la sesión de Meta)
    const onMessage = (event: MessageEvent) => {
      if (!event.origin.endsWith("facebook.com")) return;
      try {
        const data = JSON.parse(event.data);
        if (data.type !== "WA_EMBEDDED_SIGNUP") return;
        if (String(data.event).startsWith("FINISH")) {
          session.current.wabaId = data.data?.waba_id;
          session.current.phoneNumberId = data.data?.phone_number_id;
          void trySend();
        } else if (data.event === "CANCEL") {
          setStatus({ state: "error", lines: [`Proceso cancelado${data.data?.current_step ? ` en «${data.data.current_step}»` : ""}.`] });
        } else if (data.event === "ERROR") {
          setStatus({ state: "error", lines: [`Meta informó un error: ${data.data?.error_message ?? "desconocido"}`] });
        }
      } catch {
        // mensajes de Meta que no son JSON: se ignoran
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
    // trySend solo usa refs y el estado; se registra una vez
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appId]);

  function launch() {
    session.current = {};
    setStatus({ state: "waiting", lines: ["Siga los pasos en la ventana de Meta…"] });
    window.FB!.login(
      (response) => {
        const code = response.authResponse?.code;
        if (!code) return setStatus({ state: "error", lines: ["No se completó el inicio de sesión con Meta."] });
        session.current.code = code;
        void trySend();
      },
      { config_id: configId, response_type: "code", override_default_response_type: true, extras: { setup: {} } }
    );
  }

  return (
    <div className="mt-10">
      <Script src="https://connect.facebook.net/en_US/sdk.js" strategy="afterInteractive" crossOrigin="anonymous" />
      <button
        type="button"
        onClick={launch}
        disabled={!ready || status.state === "working"}
        className="bg-ivory px-8 py-4 text-[0.72rem] tracking-[0.24em] uppercase text-ink transition-colors hover:bg-brass disabled:opacity-50"
      >
        {ready ? "Conectar con Meta" : "Cargando…"}
      </button>
      {status.lines.length > 0 && (
        <ul className={`mt-8 space-y-2 border-l pl-4 text-sm ${status.state === "error" ? "border-red-400/60 text-red-200" : "border-brass/60 text-stone"}`}>
          {status.lines.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
          {status.state === "done" && <li className="text-ivory">✓ Listo. Deje la app abierta unos minutos mientras se sincroniza el historial.</li>}
        </ul>
      )}
    </div>
  );
}
