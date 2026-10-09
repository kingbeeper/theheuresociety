import Link from "next/link";

export const metadata = { title: "Enlace caducado" };

// Invitación o recuperación que ya se usó o caducó
export default function ExpiredLinkPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(ellipse_70%_60%_at_50%_45%,var(--color-emerald)_0%,var(--color-ink)_75%)] px-5">
      <div className="w-full max-w-sm text-center">
        <p className="eyebrow">The Heure Society</p>
        <h1 className="mt-4 font-display text-3xl font-light">Este enlace ya no es válido</h1>
        <p className="mt-4 text-sm text-stone">Los enlaces de acceso son de un solo uso y caducan en poco tiempo. Pide uno nuevo a quien te dio acceso al CRM.</p>
        <Link href="/admin/login" className="mt-8 inline-block text-[0.66rem] tracking-[0.2em] uppercase text-brass hover:text-ivory">Ir al inicio de sesión</Link>
      </div>
    </main>
  );
}
