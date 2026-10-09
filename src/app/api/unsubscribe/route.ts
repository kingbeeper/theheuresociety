import { adminDb } from "@/lib/supabase";
import { addEvent } from "@/lib/crm";
import { validUnsubscribe } from "@/lib/newsletter";

// Baja de los correos de novedades (enlace al pie de cada correo y cabecera List-Unsubscribe)
async function unsubscribe(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("c") ?? "";
  const token = url.searchParams.get("t") ?? "";
  if (!/^[0-9a-f-]{36}$/.test(id) || !validUnsubscribe(id, token)) return null;
  await adminDb().from("customers").update({ email_opt_out: true }).eq("id", id);
  await addEvent(id, "newsletter", "Se dio de baja de los correos de novedades", {}, "cliente");
  return id;
}

const page = (ok: boolean) =>
  new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>The Heure Society</title></head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0b100d;color:#f1ece2;font-family:Georgia,serif;text-align:center;padding:24px">
<div><p style="letter-spacing:4px;font-size:13px;color:#c8b07a">THE HEURE SOCIETY</p>
<p style="font-size:22px">${ok ? "You've been unsubscribed. · Se ha dado de baja." : "This link is no longer valid. · Este enlace ya no es válido."}</p></div></body></html>`,
    { status: ok ? 200 : 400, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );

export async function GET(request: Request) {
  return page(Boolean(await unsubscribe(request)));
}

// «Baja con un clic» de Gmail y otros (List-Unsubscribe-Post)
export async function POST(request: Request) {
  return (await unsubscribe(request)) ? new Response("ok") : new Response("invalid", { status: 400 });
}
