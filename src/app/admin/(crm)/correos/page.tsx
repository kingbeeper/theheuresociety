import { connection } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { audience, buildEmail, defaultIntro, emailConfigured, recentWatches } from "@/lib/newsletter";
import { Card, money, PageTitle, requestTime } from "@/components/admin/ui";
import { NewsletterSend } from "@/components/admin/NewsletterSend";

export const metadata = { title: "Correos" };

export default async function NewsletterPage({ searchParams }: PageProps<"/admin/correos">) {
  await connection();
  await requireAdmin();
  const sp = await searchParams;
  const watches = await recentWatches(60);
  // Sin elección: los publicados en las últimas 2 semanas
  const chosen = sp.w ? (Array.isArray(sp.w) ? sp.w : [sp.w]) : watches.filter((w) => w.published_at >= new Date(requestTime() - 14 * 86_400_000).toISOString()).map((w) => w.id);
  const selected = watches.filter((w) => chosen.includes(w.id));
  const byBrand = sp.w ? sp.marca === "1" : true;
  const lang = sp.idioma === "en" ? "en" : "es";
  const people = await audience(byBrand ? [...new Set(selected.map((w) => w.brand))] : null);
  const configured = emailConfigured();
  const preview = buildEmail(selected, { id: "00000000-0000-0000-0000-000000000000", name: lang === "es" ? "Cliente" : "Client", lang }, defaultIntro(lang === "es"));

  return (
    <>
      <PageTitle eyebrow="CRM" title="Correos de novedades" />
      {!configured && (
        <div className="mb-6 border border-amber-300/40 bg-amber-300/5 p-4 text-sm leading-relaxed">
          <p className="font-medium">Falta activar el envío de correos</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-stone">
            <li>Crea una cuenta en resend.com y verifica tu dominio (te da unos registros DNS para copiar en tu proveedor de dominio).</li>
            <li>Crea una API key y ponla en <code>.env.local</code> como <code>RESEND_API_KEY</code>, con <code>EMAIL_FROM=The Heure Society &lt;hola@tudominio.com&gt;</code>.</li>
            <li>Ejecuta <code>node scripts/vercel-env.mjs</code> para pasarlas a Vercel.</li>
          </ol>
          <p className="mt-2 text-stone">Mientras tanto puedes preparar el correo y ver la vista previa.</p>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card title="1 · Relojes (publicados en los últimos 60 días)">
            {watches.length ? (
              <form action="/admin/correos" className="grid gap-2">
                {watches.map((w) => (
                  <label key={w.id} className="flex items-center gap-3 border-b border-line/60 pb-2 text-sm">
                    <input type="checkbox" name="w" value={w.id} defaultChecked={chosen.includes(w.id)} className="h-4 w-4" />
                    <span className="min-w-0 flex-1 truncate">{w.brand} {w.model} <span className="text-stone">· {w.reference}</span></span>
                    <span className="shrink-0 text-xs text-stone">{w.price == null ? "a consultar" : money(w.price)}</span>
                  </label>
                ))}
                <label className="mt-2 flex items-center gap-2 text-sm text-stone">
                  <input type="checkbox" name="marca" value="1" defaultChecked={byBrand} className="h-4 w-4" /> Solo a clientes interesados en estas marcas
                </label>
                <input type="hidden" name="idioma" value={lang} />
                <button className="mt-2 justify-self-start border border-line px-4 py-2 text-[0.66rem] tracking-[0.2em] uppercase text-stone hover:text-ivory">Actualizar</button>
              </form>
            ) : (
              <p className="text-sm text-stone">No hay relojes publicados en los últimos 60 días.</p>
            )}
          </Card>

          <Card title={`2 · Destinatarios · ${people.length}`}>
            <p className="text-sm text-stone">
              Clientes con correo que no se han dado de baja{byBrand ? `, interesados en ${[...new Set(selected.map((w) => w.brand))].join(", ") || "—"}` : ""}
              {byBrand ? " (por lo que buscan, sus avisos o lo que compraron)" : ""}.
            </p>
            {people.length > 0 && <p className="mt-2 text-xs text-stone">{people.slice(0, 15).map((p) => p.name ?? p.email).join(" · ")}{people.length > 15 ? ` · y ${people.length - 15} más` : ""}</p>}
          </Card>

          <Card title="3 · Enviar">
            <NewsletterSend ids={selected.map((w) => w.id)} byBrand={byBrand} count={people.length} introEn={defaultIntro(false)} introEs={defaultIntro(true)} configured={configured} />
          </Card>
        </div>

        <Card title="Vista previa">
          <div className="mb-3 flex gap-3 text-[0.62rem] tracking-[0.18em] uppercase">
            {(["es", "en"] as const).map((l) => (
              <a key={l} href={`?${new URLSearchParams([...chosen.map((id) => ["w", id]), ["marca", byBrand ? "1" : "0"], ["idioma", l]]).toString()}`} className={lang === l ? "text-brass" : "text-stone hover:text-ivory"}>
                {l === "es" ? "Español" : "Inglés"}
              </a>
            ))}
          </div>
          <iframe title="Vista previa del correo" srcDoc={preview} className="h-[720px] w-full border border-line bg-ink" sandbox="" />
        </Card>
      </div>
    </>
  );
}
