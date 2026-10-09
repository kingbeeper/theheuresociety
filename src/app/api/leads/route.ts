import { z } from "zod";
import { adminDb, PHOTO_BUCKET } from "@/lib/supabase";
import { addWatchAlert, upsertLead } from "@/lib/crm";
import { escapeHtml as h, notifyAdmins } from "@/lib/telegram";
import { isBookable, miamiToUtc, slotClash, takenSlotKeys } from "@/lib/booking";

// Leads de los formularios de la web. Se guardan antes de abrir WhatsApp, así no se pierde
// ninguno aunque el visitante no llegue a enviar el mensaje.

const contact = {
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(40).optional().default(""),
  email: z.string().trim().max(160).optional().default(""),
  lang: z.enum(["es", "en"]).default("es"),
  website: z.string().optional(), // trampa para bots: un humano no ve este campo
};

const Booking = z.object({
  type: z.literal("booking"),
  ...contact,
  kind: z.enum(["office", "video"]),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  pieces: z.array(z.string()).max(20).default([]),
  note: z.string().max(2000).optional().default(""),
});

const Sell = z.object({
  type: z.enum(["sell", "trade", "consign"]),
  ...contact,
  brand: z.string().trim().min(1).max(80),
  model: z.string().max(120).optional().default(""),
  reference: z.string().max(60).optional().default(""),
  details: z.string().max(3000).optional().default(""),
  photos: z.array(z.object({ name: z.string(), type: z.string() })).max(6).default([]),
});

const Alert = z.object({
  type: z.literal("alert"),
  ...contact,
  query: z.string().trim().min(2).max(200),
  budget: z.string().max(60).optional().default(""),
});

const Lead = z.discriminatedUnion("type", [Booking, Sell, Alert]);

// Horarios ya ocupados (solo «AAAA-MM-DD HH:MM» en hora de Miami, sin datos de nadie)
export async function GET() {
  const { data } = await adminDb()
    .from("appointments")
    .select("starts_at")
    .in("status", ["requested", "confirmed"])
    .gte("starts_at", new Date().toISOString());
  const taken = takenSlotKeys((data ?? []).map((r) => new Date(r.starts_at as string)));
  return Response.json({ taken }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const parsed = Lead.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, error: "Datos incompletos" }, { status: 400 });
  const lead = parsed.data;
  if (lead.website) return Response.json({ ok: true }); // bot: se ignora en silencio
  if (!lead.phone && !lead.email) return Response.json({ ok: false, error: "Falta un teléfono o correo" }, { status: 400 });

  const db = adminDb();
  const base = { name: lead.name, phone: lead.phone, email: lead.email, lang: lead.lang };

  if (lead.type === "booking") {
    const customer = await upsertLead({
      ...base,
      source: "web_booking",
      intent: "buy",
      stage: "appointment",
      event: { type: "appointment", body: `Solicita cita (${lead.kind === "office" ? "oficina" : "videollamada"}) el ${lead.date} a las ${lead.time}`, meta: { pieces: lead.pieces } },
    });
    if (isBookable(lead.date, lead.time)) {
      if (await slotClash(miamiToUtc(lead.date, lead.time))) return Response.json({ ok: false, taken: true });
      const { error } = await db.from("appointments").insert({
        kind: lead.kind,
        starts_at: miamiToUtc(lead.date, lead.time).toISOString(),
        name: lead.name,
        phone: customer.phone,
        email: customer.email,
        pieces: lead.pieces,
        note: lead.note || null,
        source: "web",
        customer_id: customer.id,
      });
      if (error?.code === "23505") return Response.json({ ok: false, taken: true });
      if (error) throw error;
    }
    return Response.json({ ok: true });
  }

  if (lead.type === "alert") {
    const customer = await upsertLead({
      ...base,
      source: "web_alert",
      intent: "buy",
      interests: lead.budget ? `${lead.query} (presupuesto: ${lead.budget})` : lead.query,
    });
    await addWatchAlert(customer.id, lead.query);
    return Response.json({ ok: true });
  }

  // Vender, intercambiar o consignar: se crea la solicitud y se devuelven enlaces para subir las fotos
  const customer = await upsertLead({
    ...base,
    source: lead.type === "consign" ? "web_consign" : "web_sell",
    intent: lead.type,
    stage: "qualified",
    event: { type: "sell_request", body: `${{ sell: "Vende", trade: "Intercambia", consign: "Consigna" }[lead.type]}: ${[lead.brand, lead.model, lead.reference].filter(Boolean).join(" ")}` },
  });
  const id = crypto.randomUUID();
  const bucket = db.storage.from(PHOTO_BUCKET);
  const uploads = await Promise.all(
    lead.photos.map(async (p, i) => {
      const ext = p.type.includes("png") ? "png" : p.type.includes("webp") ? "webp" : "jpg";
      const path = `leads/${id}/${i + 1}.${ext}`;
      const { data } = await bucket.createSignedUploadUrl(path);
      return data ? { path, url: data.signedUrl, publicUrl: bucket.getPublicUrl(path).data.publicUrl } : null;
    })
  );
  const ok = uploads.filter((u): u is NonNullable<typeof u> => Boolean(u));
  const { error } = await db.from("sell_requests").insert({
    id,
    kind: lead.type,
    name: lead.name,
    email: customer.email,
    phone: customer.phone,
    brand: lead.brand,
    model: lead.model || null,
    reference: lead.reference || null,
    message: lead.details || null,
    image_paths: ok.map((u) => u.publicUrl),
    customer_id: customer.id,
  });
  if (error) throw error;
  await notifyAdmins(
    [
      `⌚ <b>${{ sell: "Venta", trade: "Intercambio", consign: "Consignación" }[lead.type]} · web</b>`,
      `<b>${h([lead.brand, lead.model, lead.reference && `(${lead.reference})`].filter(Boolean).join(" "))}</b>`,
      `${h(lead.name)}${customer.phone ? ` · ${customer.phone}` : ""}${customer.email ? ` · ${h(customer.email)}` : ""}`,
      lead.details ? h(lead.details) : "",
      ok.length ? `${ok.length} foto(s): se ven en el CRM` : "",
    ].filter(Boolean).join("\n")
  ).catch(() => {});
  return Response.json({ ok: true, uploads: ok.map(({ url }) => url) });
}
