// Envío de leads desde los formularios de la web (en el navegador). No bloquea: el formulario
// sigue abriendo WhatsApp al momento y el lead se guarda en segundo plano.

export type LeadPayload = Record<string, unknown> & { type: "booking" | "sell" | "trade" | "consign" | "alert" };

export async function sendLead(payload: LeadPayload, files: File[] = []) {
  try {
    const res = await fetch("/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: files.length === 0, // si el visitante cambia de página, el envío sigue
      body: JSON.stringify({ ...payload, photos: files.map((f) => ({ name: f.name, type: f.type })) }),
    });
    const json = (await res.json()) as { ok: boolean; taken?: boolean; uploads?: string[] };
    // Fotos directamente al almacenamiento, con los enlaces firmados que devuelve el servidor
    await Promise.all(
      (json.uploads ?? []).map((url, i) => {
        const form = new FormData();
        form.append("cacheControl", "3600");
        form.append("", files[i]);
        return fetch(url, { method: "PUT", body: form }).catch(() => null);
      })
    );
    return json;
  } catch {
    return { ok: false };
  }
}
