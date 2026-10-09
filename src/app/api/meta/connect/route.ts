import { adminEmail } from "@/lib/admin-auth";
import { GRAPH, graph, META_APP_ID, META_APP_SECRET, saveSettings } from "@/lib/meta";

// Conexión de Instagram y la página de Facebook desde el CRM (botón «Conectar»).
// 1. Token de usuario de corta duración (del inicio de sesión con Facebook) → de larga duración
// 2. Páginas que administra, con su Instagram profesional vinculado
// 3. Token de la página (con un token de usuario de larga duración, no caduca) y suscripción a los avisos

type Page = { id: string; name: string; access_token: string; instagram_business_account?: { id: string; username?: string } };

export async function POST(request: Request) {
  const email = await adminEmail("redes");
  if (!email) return Response.json({ ok: false, error: "Sesión no válida" }, { status: 401 });
  if (!META_APP_ID || !META_APP_SECRET) return Response.json({ ok: false, error: "Faltan el ID o la clave secreta de la app de Meta" }, { status: 400 });

  const { userToken, pageId } = (await request.json()) as { userToken?: string; pageId?: string };
  if (!userToken) return Response.json({ ok: false, error: "Falta el inicio de sesión con Facebook" }, { status: 400 });

  try {
    const exchange = new URL(`${GRAPH}/oauth/access_token`);
    exchange.search = new URLSearchParams({ grant_type: "fb_exchange_token", client_id: META_APP_ID, client_secret: META_APP_SECRET, fb_exchange_token: userToken }).toString();
    const ex = (await (await fetch(exchange)).json()) as { access_token?: string; error?: { message?: string } };
    if (!ex.access_token) throw new Error(`Token de larga duración: ${ex.error?.message ?? "error"}`);

    const { data: pages } = await graph<{ data: Page[] }>("me/accounts", ex.access_token, {
      fields: "id,name,access_token,instagram_business_account{id,username}",
      limit: 100,
    });
    if (!pages?.length) throw new Error("Esta cuenta de Facebook no administra ninguna página.");

    // Elegida por el usuario, o la que tiene Instagram vinculado (si solo hay una)
    const withIg = pages.filter((p) => p.instagram_business_account);
    const page = pages.find((p) => p.id === pageId) ?? (withIg.length === 1 ? withIg[0] : pages.length === 1 ? pages[0] : null);
    if (!page) {
      return Response.json({ ok: false, choose: pages.map((p) => ({ id: p.id, name: p.name, instagram: p.instagram_business_account?.username ?? null })) });
    }

    // Avisos de la página: mensajes de Messenger y publicaciones/comentarios. Los de Instagram (DM y
    // comentarios) llegan por la misma suscripción de la app a la página vinculada.
    let subscribed = true;
    try {
      await graph(`${page.id}/subscribed_apps`, page.access_token, { subscribed_fields: "messages,messaging_postbacks,feed" }, { method: "POST" });
    } catch {
      subscribed = false; // sin aprobación de Meta todavía: las métricas funcionan igual
    }

    await saveSettings({
      page_id: page.id,
      page_name: page.name,
      page_token: page.access_token,
      ig_id: page.instagram_business_account?.id ?? null,
      ig_username: page.instagram_business_account?.username ?? null,
      connected_at: new Date().toISOString(),
      connected_by: email,
    });

    return Response.json({
      ok: true,
      page: page.name,
      instagram: page.instagram_business_account?.username ?? null,
      subscribed,
    });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
