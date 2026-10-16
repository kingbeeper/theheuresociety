import { redirect } from "next/navigation";
import { adminEmail } from "@/lib/admin-auth";
import { backupLink } from "@/lib/backup";

// Descargar una copia de seguridad (solo con permiso de informes): enlace firmado de 1 minuto
export async function GET(request: Request) {
  if (!(await adminEmail("informes"))) return new Response("Unauthorized", { status: 401 });
  const name = new URL(request.url).searchParams.get("f") ?? "";
  if (!/^copia-[\w-]+\.xlsx$/.test(name)) return new Response("Archivo no válido", { status: 400 });
  const link = await backupLink(name, 60);
  if (!link) return new Response("No existe", { status: 404 });
  redirect(link);
}
