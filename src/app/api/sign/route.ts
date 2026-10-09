import { adminDb } from "@/lib/supabase";
import { addEvent } from "@/lib/crm";
import { uploadPrivate } from "@/lib/private-files";
import { escapeHtml as h, notifyAdmins } from "@/lib/telegram";
import { KIND_LABEL, type Doc } from "@/lib/doc-labels";

// Firma electrónica desde el enlace del cliente: guarda la imagen de la firma (privada), el nombre,
// la fecha, la IP y el navegador, y avisa al equipo.
const SIGNABLE = ["memo", "consignment", "purchase", "invoice", "quote"];
const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://theheuresociety.vercel.app").replace(/\/$/, "");

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { token?: string; name?: string; image?: string; accept?: boolean } | null;
  const token = body?.token ?? "";
  const name = (body?.name ?? "").trim().slice(0, 120);
  const image = body?.image ?? "";
  if (!/^[\w-]{20,40}$/.test(token) || name.length < 2 || !body?.accept) return Response.json({ ok: false, error: "Faltan datos" }, { status: 400 });
  const m = image.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
  if (!m || m[1].length > 400_000) return Response.json({ ok: false, error: "Firma no válida" }, { status: 400 });

  const db = adminDb();
  const { data } = await db.from("documents").select("*").eq("token", token).maybeSingle();
  const d = data as (Doc & { signed_at?: string | null }) | null;
  if (!d || d.status !== "sent" || !SIGNABLE.includes(d.kind)) return Response.json({ ok: false, error: "Este documento no se puede firmar" }, { status: 404 });
  if (d.signed_at) return Response.json({ ok: false, error: "Ya está firmado" }, { status: 409 });

  const path = `signatures/${d.id}.png`;
  await uploadPrivate(path, Buffer.from(m[1], "base64"), "image/png");
  const ip = (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || null;
  const signedAt = new Date().toISOString();
  const { error } = await db
    .from("documents")
    .update({ signed_at: signedAt, signer_name: name, signature_path: path, signed_ip: ip, signed_ua: request.headers.get("user-agent")?.slice(0, 300) ?? null })
    .eq("id", d.id)
    .is("signed_at", null);
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  if (d.customer_id) await addEvent(d.customer_id, "document", `${KIND_LABEL[d.kind]} ${d.number}: firmada electrónicamente por ${name}`, { document: d.id, ip }, "cliente");
  await notifyAdmins(`✍️ <b>${h(name)}</b> firmó ${h(KIND_LABEL[d.kind].toLowerCase())} <b>${h(d.number)}</b>\n${SITE}/d/${d.token}/pdf`).catch(() => {});
  return Response.json({ ok: true });
}
