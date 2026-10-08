import { adminDb } from "@/lib/supabase";
import { GRAPH } from "@/lib/whatsapp";

// Conexión del número de WhatsApp Business (coexistencia) desde /admin/whatsapp.
// Pasos de Meta para un Tech Provider: canjear el código por el token del negocio, suscribir la
// app a los webhooks de la cuenta, y sincronizar contactos e historial en las primeras 24 h.
// (El número ya está registrado en la app WhatsApp Business: no se registra de nuevo.)

type Body = { key?: string; code?: string; wabaId?: string; phoneNumberId?: string };

async function graph(path: string, token: string, init: RequestInit = {}) {
  const res = await fetch(`${GRAPH}/${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers } });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: { message?: string } };
  if (!res.ok) throw new Error(`${path}: ${json.error?.message ?? res.status}`);
  return json;
}

export async function POST(request: Request) {
  const { key, code, wabaId, phoneNumberId } = (await request.json()) as Body;
  if (!process.env.WHATSAPP_ONBOARD_KEY || key !== process.env.WHATSAPP_ONBOARD_KEY) {
    return Response.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }
  const appId = process.env.NEXT_PUBLIC_META_APP_ID;
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!appId || !secret || !code || !wabaId) {
    return Response.json({ ok: false, error: "Faltan datos (app, secreto, código o cuenta de WhatsApp)" }, { status: 400 });
  }

  const steps: string[] = [];
  try {
    // 1. Código (caduca en 30 s) → token del negocio
    const tokenUrl = new URL(`${GRAPH}/oauth/access_token`);
    tokenUrl.search = new URLSearchParams({ client_id: appId, client_secret: secret, code }).toString();
    const tokenRes = await fetch(tokenUrl);
    const tokenJson = (await tokenRes.json()) as { access_token?: string; error?: { message?: string } };
    if (!tokenJson.access_token) throw new Error(`Canje del código: ${tokenJson.error?.message ?? tokenRes.status}`);
    const token = tokenJson.access_token;
    steps.push("Token del negocio obtenido");

    // 2. Webhooks de la cuenta hacia esta app
    await graph(`${wabaId}/subscribed_apps`, token, { method: "POST" });
    steps.push("App suscrita a los mensajes de la cuenta");

    // 3. Id del número (si el flujo no lo devolvió)
    let phoneId = phoneNumberId;
    if (!phoneId) {
      const phones = (await graph(`${wabaId}/phone_numbers?fields=id,display_phone_number`, token)) as { data?: { id: string; display_phone_number: string }[] };
      phoneId = phones.data?.[0]?.id;
      if (!phoneId) throw new Error("La cuenta no tiene ningún número");
    }
    steps.push(`Número conectado (id ${phoneId})`);

    // 4. Guardar la conexión (el bot la lee de aquí)
    const now = new Date().toISOString();
    const { error } = await adminDb().from("wa_settings").upsert(
      [
        { key: "token", value: token, updated_at: now },
        { key: "phone_number_id", value: phoneId, updated_at: now },
        { key: "waba_id", value: wabaId, updated_at: now },
        { key: "onboarded_at", value: now, updated_at: now },
      ],
      { onConflict: "key" }
    );
    if (error) throw new Error(`Guardar la conexión: ${error.message}`);
    steps.push("Conexión guardada");

    // 5. Sincronizar contactos e historial de la app (obligatorio en 24 h; solo se puede una vez)
    for (const sync_type of ["smb_app_state_sync", "history"]) {
      try {
        await graph(`${phoneId}/smb_app_data`, token, { method: "POST", body: JSON.stringify({ messaging_product: "whatsapp", sync_type }) });
        steps.push(sync_type === "history" ? "Historial sincronizándose" : "Contactos sincronizándose");
      } catch (e) {
        steps.push(`Aviso: ${(e as Error).message}`);
      }
    }
    return Response.json({ ok: true, steps });
  } catch (e) {
    return Response.json({ ok: false, steps, error: (e as Error).message }, { status: 500 });
  }
}
