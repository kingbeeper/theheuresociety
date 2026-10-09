import { LoginForm } from "./LoginForm";

export const metadata = { title: "Acceso" };

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(ellipse_70%_60%_at_50%_45%,var(--color-emerald)_0%,var(--color-ink)_75%)] px-5">
      <div className="w-full max-w-sm text-center">
        <p className="eyebrow">The Heure Society</p>
        <h1 className="mt-4 font-display text-4xl font-light">CRM</h1>
        <LoginForm />
      </div>
    </main>
  );
}
