import { currentUser } from "@/lib/admin-auth";
import { can } from "@/lib/crm-perms";
import { adminDb } from "@/lib/supabase";
import { KIND_LABEL, STATUS_LABEL, type DocKind, type DocStatus } from "@/lib/doc-labels";

// Buscador global del CRM (Ctrl/Cmd + K): clientes, relojes, seriales, documentos y citas.
// Cada grupo solo aparece si el usuario tiene permiso para esa sección.

type Result = { group: string; title: string; sub: string; href: string };

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const raw = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 60);
  const q = raw.replace(/[,()%*\\]/g, " ").replace(/\s+/g, " ").trim();
  if (q.length < 2) return Response.json({ results: [] });
  // Varias palabras («Rolex 126»): se busca la más larga y luego se exige que estén todas
  const tokens = q.toLowerCase().split(" ").filter(Boolean);
  const main = [...tokens].sort((a, b) => b.length - a.length)[0];
  const like = `%${tokens.length > 1 ? main : q}%`;
  const all = (...fields: (string | null | undefined)[]) => {
    const text = fields.filter(Boolean).join(" ").toLowerCase();
    return tokens.every((t) => text.includes(t));
  };
  const digits = q.replace(/\D/g, "");
  const compact = q.replace(/[^a-z0-9]/gi, "").toUpperCase();
  const db = adminDb();
  const tasks: Promise<Result[]>[] = [];

  if (can(user, "leads")) {
    const filters = [`name.ilike.${like}`, `email.ilike.${like}`, digits.length >= 4 && `phone.ilike.%${digits.slice(-7)}%`].filter(Boolean).join(",");
    tasks.push(
      Promise.resolve(db.from("customers").select("id, name, phone, email, stage").or(filters).order("last_activity_at", { ascending: false }).limit(30)).then(({ data }) =>
        (data ?? []).filter((c) => digits.length >= 4 && tokens.length === 1 ? true : all(c.name, c.phone, c.email)).slice(0, 6).map((c) => ({ group: "Clientes", title: c.name ?? c.phone ?? c.email ?? "Cliente", sub: [c.phone, c.email].filter(Boolean).join(" · "), href: `/admin/leads/${c.id}` }))
      )
    );
  }
  if (can(user, "inventario")) {
    const filters = [`sku.ilike.${like}`, `brand.ilike.${like}`, `model.ilike.${like}`, `reference.ilike.${like}`, `serial.ilike.${like}`].join(",");
    tasks.push(
      Promise.resolve(db.from("inventory_items").select("id, sku, brand, model, reference, status, serial").or(filters).order("created_at", { ascending: false }).limit(40)).then(({ data }) =>
        (data ?? []).filter((i) => all(i.sku, i.brand, i.model, i.reference, i.serial)).slice(0, 8).map((i) => ({
          group: "Relojes",
          title: `${i.sku} · ${[i.brand, i.model, i.reference].filter(Boolean).join(" ")}`,
          sub: [{ in_stock: "Disponible", reserved: "Reservado", sold: "Vendido", returned: "Devuelto" }[i.status as string] ?? i.status, i.serial && `Serie ${i.serial}`].filter(Boolean).join(" · "),
          href: `/admin/inventario/${i.id}`,
        }))
      )
    );
    // Historial de seriales (incluye relojes que ya salieron hace tiempo)
    if (compact.length >= 4 && /\d/.test(compact)) {
      tasks.push(
        Promise.resolve(db.from("serial_log").select("serial, watch").eq("serial_norm", compact).limit(1)).then(({ data }) =>
          (data ?? []).map((r) => ({ group: "Historial de seriales", title: `Serie ${r.serial}`, sub: r.watch ?? "Todo lo que pasó con este reloj", href: `/admin/inventario/serial?s=${encodeURIComponent(r.serial)}` }))
        )
      );
    }
  }
  if (can(user, "documentos")) {
    tasks.push(
      Promise.resolve(db.from("documents").select("id, kind, number, status, client_name, total").or(`number.ilike.${like},client_name.ilike.${like}`).order("created_at", { ascending: false }).limit(30)).then(({ data }) =>
        (data ?? []).filter((d) => all(d.number, d.client_name)).slice(0, 6).map((d) => ({
          group: "Documentos",
          title: `${KIND_LABEL[d.kind as DocKind] ?? d.kind} ${d.number}`,
          sub: [d.client_name, STATUS_LABEL[d.kind as DocKind]?.[d.status as DocStatus], `$${Number(d.total).toLocaleString("en-US")}`].filter(Boolean).join(" · "),
          href: `/admin/documentos/${d.id}`,
        }))
      )
    );
  }
  if (can(user, "citas")) {
    tasks.push(
      Promise.resolve(db.from("appointments").select("id, name, starts_at, status, customer_id").ilike("name", like).order("starts_at", { ascending: false }).limit(4)).then(({ data }) =>
        (data ?? []).map((a) => ({
          group: "Citas",
          title: a.name ?? "Cita",
          sub: `${new Intl.DateTimeFormat("es-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(a.starts_at))}${a.status === "cancelled" ? " · cancelada" : ""}`,
          href: a.customer_id ? `/admin/leads/${a.customer_id}` : "/admin/citas",
        }))
      )
    );
  }

  const results = (await Promise.all(tasks.map((t) => t.catch(() => [] as Result[])))).flat();
  return Response.json({ results }, { headers: { "Cache-Control": "no-store" } });
}
