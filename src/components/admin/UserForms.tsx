"use client";

import { useActionState, useState } from "react";
import { addUser, changePassword, newAccessLink, updateUser } from "@/app/admin/user-actions";
import { PRESETS, SECTIONS, type Section } from "@/lib/crm-perms";

const field =
  "w-full border border-line bg-ink/60 px-3 py-2.5 text-sm text-ivory placeholder:text-stone/50 outline-none transition-colors focus:border-brass/70";
const label = "mb-1.5 block text-[0.62rem] tracking-[0.22em] uppercase text-stone";
const button = "bg-ivory px-5 py-2.5 text-[0.68rem] tracking-[0.22em] uppercase text-ink hover:bg-brass disabled:opacity-60";

// Comisión y Telegram
function Extras({ rate = 0, base = "profit", telegram = "" }: { rate?: number; base?: string; telegram?: string | null }) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <label><span className={label}>Comisión (%)</span><input name="commission_rate" inputMode="decimal" defaultValue={rate || ""} placeholder="0" className={field} /></label>
      <label>
        <span className={label}>Sobre</span>
        <select name="commission_base" defaultValue={base} className={field}>
          <option value="profit">la ganancia</option>
          <option value="sale">el precio de venta</option>
        </select>
      </label>
      <label><span className={label}>ID de Telegram</span><input name="telegram_id" inputMode="numeric" defaultValue={telegram ?? ""} placeholder="Opcional" className={field} /></label>
      <p className="text-xs text-stone sm:col-span-3">El ID de Telegram se lo dice el robot al escribirle. Sirve para saber quién vende desde Telegram y para avisarle de sus tareas (añádelo también a TELEGRAM_ADMIN_IDS si debe usar el robot).</p>
    </div>
  );
}

// Plantilla + casillas de permisos
function Permissions({ initialPreset, initial }: { initialPreset: string; initial: Section[] }) {
  const [preset, setPreset] = useState(initialPreset);
  const [perms, setPerms] = useState<Section[]>(initial);
  const admin = PRESETS[preset]?.role === "admin";
  return (
    <div className="grid gap-3">
      <label>
        <span className={label}>Tipo de acceso</span>
        <select
          name="preset"
          value={preset}
          onChange={(e) => {
            setPreset(e.target.value);
            if (e.target.value !== "custom") setPerms(PRESETS[e.target.value].permissions);
          }}
          className={field}
        >
          {Object.entries(PRESETS).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
        </select>
      </label>
      {!admin && (
        <div className="grid gap-2 sm:grid-cols-2">
          {(Object.entries(SECTIONS) as [Section, string][]).map(([k, l]) => (
            <label key={k} className={`flex items-center gap-2 text-sm ${k === "costos" || k === "usuarios" ? "text-amber-200" : "text-stone"}`}>
              <input
                type="checkbox"
                name="perm"
                value={k}
                checked={perms.includes(k)}
                onChange={(e) => {
                  setPreset("custom");
                  setPerms(e.target.checked ? [...perms, k] : perms.filter((p) => p !== k));
                }}
                className="h-4 w-4"
              />
              {l}
            </label>
          ))}
        </div>
      )}
      {admin && <p className="text-xs text-stone">Ve y gestiona todo, incluidos costos, informes y usuarios.</p>}
    </div>
  );
}

// Enlace para entrar: se copia o se envía por WhatsApp (caduca en poco tiempo)
function LinkBox({ email, link }: { email: string; link: string }) {
  const msg = `Hola, te doy acceso al CRM de The Heure Society. Entra con este enlace y elige tu contraseña (caduca pronto): ${link}`;
  return (
    <div className="mt-4 border border-emerald-300/40 bg-emerald-300/5 p-4 text-sm">
      <p>Enlace de acceso para <b>{email}</b>. Envíaselo; al abrirlo elegirá su contraseña.</p>
      <p className="mt-2 break-all text-xs text-stone">{link}</p>
      <div className="mt-3 flex flex-wrap gap-3 text-[0.62rem] tracking-[0.18em] uppercase">
        <button type="button" onClick={() => navigator.clipboard.writeText(link)} className="text-brass hover:text-ivory">Copiar enlace</button>
        <a href={`https://wa.me/?text=${encodeURIComponent(msg)}`} target="_blank" rel="noreferrer" className="text-brass hover:text-ivory">Enviar por WhatsApp</a>
        <a href={`mailto:${email}?subject=${encodeURIComponent("Acceso al CRM de The Heure Society")}&body=${encodeURIComponent(msg)}`} className="text-brass hover:text-ivory">Enviar por correo</a>
      </div>
      <p className="mt-2 text-xs text-stone">Es de un solo uso y caduca en poco tiempo (normalmente 1 hora): si no le llega a tiempo, genera otro.</p>
    </div>
  );
}

export function AddUserForm() {
  const [state, action, pending] = useActionState(addUser, null);
  return (
    <form action={action} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label><span className={label}>Nombre</span><input name="name" className={field} /></label>
        <label><span className={label}>Correo *</span><input name="email" type="email" required className={field} /></label>
      </div>
      <Permissions initialPreset="seller" initial={PRESETS.seller.permissions} />
      <Extras />
      <div className="flex items-center gap-4">
        <button disabled={pending} className={button}>{pending ? "Guardando…" : "Dar acceso"}</button>
        {state && "error" in state && <p className="text-sm text-red-200/90">{state.error}</p>}
      </div>
      {state && "link" in state && state.link && <LinkBox email={state.email!} link={state.link} />}
    </form>
  );
}

export function EditUserForm({ email, name, role, permissions, rate, base, telegram }: { email: string; name: string | null; role: string; permissions: Section[]; rate?: number; base?: string; telegram?: string | null }) {
  const [state, action, pending] = useActionState(updateUser.bind(null, email), null);
  const preset = role === "admin" ? "admin" : Object.entries(PRESETS).find(([, p]) => p.role === "staff" && p.permissions.length === permissions.length && p.permissions.every((x) => permissions.includes(x)))?.[0] ?? "custom";
  return (
    <form action={action} className="grid gap-4">
      <label><span className={label}>Nombre</span><input name="name" defaultValue={name ?? ""} className={field} /></label>
      <Permissions initialPreset={preset} initial={permissions} />
      <Extras rate={rate} base={base} telegram={telegram} />
      <div className="flex items-center gap-4">
        <button disabled={pending} className={button}>{pending ? "Guardando…" : "Guardar"}</button>
        {state && "error" in state && <p className="text-sm text-red-200/90">{state.error}</p>}
        {state && "ok" in state && !pending && <p className="text-sm text-emerald-200/90">Guardado</p>}
      </div>
    </form>
  );
}

export function NewLinkButton({ email }: { email: string }) {
  const [state, action, pending] = useActionState(async () => newAccessLink(email), null);
  return (
    <form action={action}>
      <button disabled={pending} className="text-[0.62rem] tracking-[0.18em] uppercase text-stone hover:text-ivory">{pending ? "…" : "Nuevo enlace de acceso"}</button>
      {state && "error" in state && <p className="text-xs text-red-200/90">{state.error}</p>}
      {state && "link" in state && state.link && <LinkBox email={email} link={state.link} />}
    </form>
  );
}

export function PasswordForm({ welcome }: { welcome: boolean }) {
  const [state, action, pending] = useActionState(changePassword, null);
  return (
    <form action={action} className="grid max-w-md gap-4">
      {welcome && <p className="text-sm text-emerald-200/90">¡Bienvenido! Elige tu contraseña para entrar la próxima vez.</p>}
      <label><span className={label}>Nueva contraseña (mínimo 10 caracteres)</span><input name="password" type="password" autoComplete="new-password" required minLength={10} className={field} /></label>
      <label><span className={label}>Repítela</span><input name="confirm" type="password" autoComplete="new-password" required minLength={10} className={field} /></label>
      <div className="flex items-center gap-4">
        <button disabled={pending} className={button}>{pending ? "Guardando…" : "Guardar contraseña"}</button>
        {state && "error" in state && <p className="text-sm text-red-200/90">{state.error}</p>}
        {state && "ok" in state && !pending && <p className="text-sm text-emerald-200/90">Contraseña guardada</p>}
      </div>
    </form>
  );
}
