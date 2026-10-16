import Link from "next/link";
import { connection } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { tr } from "@/lib/admin-i18n";
import { ensureTemplates, templates } from "@/lib/templates";
import { Card, fieldClass, ghostButtonClass, PageTitle } from "@/components/admin/ui";
import { deleteTemplateAction, saveTemplateAction } from "../../actions";

export const metadata = { title: "Respuestas rápidas" };

// Plantillas de WhatsApp de la ficha del cliente («💬 Respuestas rápidas»), en español e inglés
export default async function TemplatesPage() {
  await connection();
  await requireAdmin("leads");
  await ensureTemplates().catch(() => {});
  const list = await templates();
  const area = `${fieldClass} min-h-24 text-sm`;

  return (
    <>
      <Link href="/admin/leads" className="text-[0.66rem] tracking-[0.2em] uppercase text-stone hover:text-ivory">{tr("← Leads")}</Link>
      <PageTitle eyebrow="Leads" title="Respuestas rápidas" />
      <p className="mb-6 max-w-3xl text-sm text-stone">
        {tr("Salen en la ficha de cada cliente con un botón de WhatsApp. Huecos que se rellenan solos:")} <code>{"{nombre}"}</code> {tr("(nombre del cliente)")}, <code>{"{reloj}"}</code>, <code>{"{precio}"}</code>, <code>{"{enlace}"}</code> {tr("(su ficha en la web)")} {tr("y")} <code>{"{pago}"}</code> {tr("(los datos de pago de Documentos → Ajustes).")}
      </p>
      <div className="grid gap-4 xl:grid-cols-2">
        {list.map((t) => (
          <Card key={t.id ?? t.title}>
            <form action={saveTemplateAction.bind(null, t.id)} className="grid gap-3">
              <input name="title" defaultValue={t.title} required className={fieldClass} />
              <label className="text-xs text-stone">{tr("Español")}<textarea name="body_es" defaultValue={t.body_es} className={area} /></label>
              <label className="text-xs text-stone">{tr("Inglés")}<textarea name="body_en" defaultValue={t.body_en} className={area} /></label>
              <div className="flex items-center gap-3">
                <button className={ghostButtonClass}>{tr("Guardar")}</button>
                {t.id && (
                  <button formAction={deleteTemplateAction.bind(null, t.id)} className="text-xs text-stone underline hover:text-red-200">{tr("Quitar")}</button>
                )}
              </div>
            </form>
          </Card>
        ))}
        <Card title="Nueva plantilla">
          <form action={saveTemplateAction.bind(null, null)} className="grid gap-3">
            <input name="title" required placeholder={tr("Título (ej. Envío asegurado)")} className={fieldClass} />
            <textarea name="body_es" placeholder={tr("Hola {nombre}, …")} className={area} />
            <textarea name="body_en" placeholder="Hi {nombre}, …" className={area} />
            <button className={ghostButtonClass}>{tr("Añadir")}</button>
          </form>
        </Card>
      </div>
    </>
  );
}
