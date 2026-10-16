"use client";

import { useEffect, useState, useTransition } from "react";
import { removePushAction, savePushAction, testPushAction } from "@/app/admin/actions";
import { useTr } from "@/components/admin/AdminLang";

const btn = "border border-line px-4 py-2 text-[0.66rem] tracking-[0.2em] uppercase text-stone hover:text-ivory disabled:opacity-50";

// La clave pública VAPID va en base64url; el navegador la quiere en bytes
function keyBytes(b64: string) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

// 🔔 Avisos en este dispositivo: nuevo lead, pago recibido y cita en una hora
export function PushToggle({ publicKey }: { publicKey: string | null }) {
  const tr = useTr();
  const [state, setState] = useState<"loading" | "unsupported" | "ios-install" | "off" | "on" | "blocked">("loading");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    (async () => {
      const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
      const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone;
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return setState(ios && !standalone ? "ios-install" : "unsupported");
      if (Notification.permission === "denied") return setState("blocked");
      const reg = await navigator.serviceWorker.getRegistration("/admin/");
      const sub = await reg?.pushManager.getSubscription();
      setState(sub ? "on" : "off");
    })().catch(() => setState("unsupported"));
  }, []);

  const enable = () =>
    start(async () => {
      setMsg(null);
      if (!publicKey) return setMsg(tr("Los avisos aún no están configurados en el servidor."));
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return setState(perm === "denied" ? "blocked" : "off");
      const reg = await navigator.serviceWorker.register("/sw-admin.js", { scope: "/admin/" });
      await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
      const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      const device = `${/iPhone|iPad/.test(navigator.userAgent) ? "iPhone/iPad" : /Mac/.test(navigator.userAgent) ? "Mac" : /Android/.test(navigator.userAgent) ? "Android" : /Windows/.test(navigator.userAgent) ? "Windows" : "Navegador"}`;
      const r = await savePushAction(json, device);
      if ("error" in r) return setMsg(r.error ?? "");
      setState("on");
      const t = await testPushAction();
      setMsg("error" in t ? (t.error ?? "") : tr("Listo: te llegó un aviso de prueba."));
    });

  const disable = () =>
    start(async () => {
      const reg = await navigator.serviceWorker.getRegistration("/admin/");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await removePushAction(sub.endpoint);
        await sub.unsubscribe();
      }
      setState("off");
      setMsg(null);
    });

  return (
    <div className="grid gap-3 text-sm">
      <p className="text-stone">{tr("Recibe en este dispositivo un aviso cuando llega un lead nuevo, cuando se registra un pago y una hora antes de cada cita.")}</p>
      {state === "ios-install" && <p className="text-amber-200">{tr("En iPhone, primero instala el CRM: en Safari, Compartir → «Añadir a pantalla de inicio». Luego ábrelo desde el icono y vuelve aquí.")}</p>}
      {state === "unsupported" && <p className="text-amber-200">{tr("Este navegador no admite avisos.")}</p>}
      {state === "blocked" && <p className="text-amber-200">{tr("Los avisos están bloqueados para esta web: actívalos en los ajustes del navegador o del teléfono.")}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {state === "off" && <button type="button" disabled={pending} onClick={enable} className={btn}>{pending ? tr("Activando…") : tr("🔔 Activar avisos en este dispositivo")}</button>}
        {state === "on" && (
          <>
            <span className="text-emerald-200">{tr("✓ Avisos activados en este dispositivo")}</span>
            <button type="button" disabled={pending} onClick={() => start(async () => { const t = await testPushAction(); setMsg("error" in t ? (t.error ?? "") : tr("Aviso de prueba enviado.")); })} className={btn}>{tr("Probar")}</button>
            <button type="button" disabled={pending} onClick={disable} className="text-xs text-stone underline hover:text-ivory">{tr("Desactivar")}</button>
          </>
        )}
      </div>
      {msg && <p className="text-xs text-stone">{msg}</p>}
    </div>
  );
}
