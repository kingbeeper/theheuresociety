"use client";

import { useActionState } from "react";
import { signIn } from "../actions";

export function LoginForm() {
  const [state, action, pending] = useActionState(signIn, null);
  const field =
    "w-full border-b border-line bg-transparent px-1 py-3 text-sm text-ivory placeholder:text-stone/50 outline-none focus:border-brass";
  return (
    <form action={action} className="mt-10 space-y-6 text-left">
      <input name="email" type="email" autoComplete="email" placeholder="Correo" className={field} required />
      <input name="password" type="password" autoComplete="current-password" placeholder="Contraseña" className={field} required />
      {state?.error && <p className="text-sm text-red-200/90">{state.error}</p>}
      <button disabled={pending} className="w-full bg-ivory py-4 text-[0.72rem] tracking-[0.24em] uppercase text-ink hover:bg-brass disabled:opacity-60">
        {pending ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}
