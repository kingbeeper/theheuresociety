import { adminDb } from "@/lib/supabase";
import { getDocSettings } from "@/lib/documents";
import { pdfName, renderDocPdf } from "@/lib/doc-pdf";
import type { Doc } from "@/lib/doc-labels";

// PDF del documento (mismo enlace privado que la página del cliente)
export async function GET(_: Request, { params }: RouteContext<"/d/[token]/pdf">) {
  const { token } = await params;
  if (!/^[\w-]{20,40}$/.test(token)) return new Response("No encontrado", { status: 404 });
  const { data } = await adminDb().from("documents").select("*").eq("token", token).maybeSingle();
  const d = data as Doc | null;
  if (!d || d.status === "draft") return new Response("No encontrado", { status: 404 });
  const bytes = await renderDocPdf(d, await getDocSettings());
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(pdfName(d))}`,
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
