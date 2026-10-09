"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { requireAdmin, requireUser } from "@/lib/admin-auth";
import { can } from "@/lib/crm-perms";
import { adminDb } from "@/lib/supabase";
import { addEvent, notifyPriceDrop, upsertLead } from "@/lib/crm";
import { SITE_URL } from "@/lib/seo";
import { createStockItem, logItem, recordPurchase, syncWebPrice, syncWebStatus, webPrice, type Item } from "@/lib/stock";
import { ACQUISITION, ITEM_STATUS, isOwnerStock } from "@/lib/stock-labels";
import { SOURCE_LABEL } from "@/lib/crm-labels";

// Acciones del inventario. Todas comprueban la sesión y dejan rastro en el historial del reloj.

const text = (f: FormData, k: string) => {
  const v = String(f.get(k) ?? "").trim();
  return v || null;
};
const money = (f: FormData, k: string) => {
  const v = text(f, k);
  if (!v) return null;
  const n = Number(v.replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const date = (f: FormData, k: string) => {
  const v = text(f, k);
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
};
const usd = (n: number | null) => (n == null ? "—" : `$${n.toLocaleString("en-US")}`);

async function getItem(id: string) {
  const { data } = await adminDb().from("inventory_items").select("*").eq("id", id).single();
  return data as Item;
}

// Datos del reloj y de su entrada (alta y edición)
function itemFields(f: FormData) {
  return {
    acquisition: (text(f, "acquisition") ?? "purchase") as Item["acquisition"],
    brand: text(f, "brand") ?? "",
    model: text(f, "model"),
    reference: text(f, "reference"),
    serial: text(f, "serial"),
    papers_date: date(f, "papers_date"),
    links: text(f, "links"),
    condition: text(f, "condition"),
    comes_with: text(f, "comes_with"),
    description: text(f, "description"),
    supplier_name: text(f, "supplier_name"),
    supplier_company: text(f, "supplier_company"),
    supplier_location: text(f, "supplier_location"),
    purchase_date: date(f, "purchase_date"),
    cost: money(f, "cost"),
    extra_costs: money(f, "extra_costs") ?? 0,
    asking_price: money(f, "asking_price"),
    memo_due: date(f, "memo_due"),
    watch_id: text(f, "watch_id"),
    notes: text(f, "notes"),
  };
}

export async function saveItem(id: string | null, _: unknown, f: FormData) {
  const me = await requireUser("inventario");
  const user = me.email;
  const fields: Partial<ReturnType<typeof itemFields>> & ReturnType<typeof itemFields> = itemFields(f);
  if (!can(me, "costos")) {
    for (const k of ["cost", "extra_costs", "supplier_name", "supplier_company", "supplier_location"] as const) delete (fields as Partial<typeof fields>)[k];
  }
  if (!fields.brand) return { error: "Falta la marca." };
  const db = adminDb();
  // Enlazado a una ficha de la web sin precio en el inventario: se toma el de la web
  if (fields.watch_id && fields.asking_price == null) fields.asking_price = await webPrice(fields.watch_id);

  if (!id) {
    const { data, error } = await db.from("inventory_items").insert(fields).select("id, sku").single();
    if (error) return { error: error.message };
    await logItem(data.id, "entry", `Entrada · ${ACQUISITION[fields.acquisition]}${fields.cost != null ? ` · costo ${usd(fields.cost)}` : ""}${fields.supplier_name ? ` · de ${fields.supplier_name}` : ""}`, user);
    await syncWebPrice(fields.watch_id, fields.asking_price);
    redirect(`/admin/inventario/${data.id}`);
  }

  const before = await getItem(id);
  const { error } = await db.from("inventory_items").update({ ...fields, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return { error: error.message };
  // Cambios relevantes en el historial (y el precio nuevo pasa a la web)
  const priceChanged = Number(before.asking_price ?? NaN) !== Number(fields.asking_price ?? NaN) && (before.asking_price != null || fields.asking_price != null);
  if (priceChanged) {
    await logItem(id, "price", `Precio: ${usd(before.asking_price)} → ${usd(fields.asking_price)}${fields.watch_id && fields.asking_price != null ? " (actualizado en la web)" : ""}`, user);
  }
  if (priceChanged || before.watch_id !== fields.watch_id) await syncWebPrice(fields.watch_id, fields.asking_price);
  // Bajada de precio de un reloj publicado → aviso con los clientes interesados
  const from = Number(before.asking_price), to = Number(fields.asking_price);
  if (priceChanged && fields.watch_id && before.asking_price != null && fields.asking_price != null && to < from) {
    const { data: w } = await db.from("watches").select("brand, model, reference, slug, status").eq("id", fields.watch_id).maybeSingle();
    if (w && (w.status === "available" || w.status === "reserved")) {
      const n = await notifyPriceDrop(w, from, to, SITE_URL).catch((e) => (console.error("Bajada de precio:", e), 0));
      if (n) await logItem(id, "price", `Aviso de bajada enviado: ${n} cliente(s) interesado(s)`, user);
    }
  }
  if (Number(before.cost ?? NaN) !== Number(fields.cost ?? NaN) && fields.cost != null) await logItem(id, "cost", `Costo: ${usd(before.cost)} → ${usd(fields.cost)}`, user);
  if ("extra_costs" in fields && Number(before.extra_costs) !== Number(fields.extra_costs)) await logItem(id, "cost", `Gastos: ${usd(before.extra_costs)} → ${usd(fields.extra_costs)}`, user);
  refresh();
  return { ok: true };
}

export async function setReserved(id: string, reserved: boolean) {
  const user = await requireAdmin("inventario");
  const item = await getItem(id);
  if (item.status === "sold" || item.status === "returned") return;
  await adminDb().from("inventory_items").update({ status: reserved ? "reserved" : "in_stock", updated_at: new Date().toISOString() }).eq("id", id);
  await logItem(id, "status", reserved ? "Reservado" : "Disponible de nuevo", user);
  await syncWebStatus(item.watch_id, reserved ? "reserved" : "available");
  refresh();
}

export async function sellItem(id: string, _: unknown, f: FormData) {
  const user = await requireAdmin("inventario");
  const item = await getItem(id);
  const price = money(f, "sale_price");
  const saleDate = date(f, "sale_date") ?? new Date().toISOString().slice(0, 10);
  if (price == null) return { error: "Falta el precio de venta." };

  // Comprador: un cliente del CRM o uno nuevo (queda como lead ganado)
  let buyerId = text(f, "buyer_customer_id");
  const buyerName = text(f, "buyer_name");
  if (!buyerId && (buyerName || text(f, "buyer_phone") || text(f, "buyer_email"))) {
    // El origen del comprador es el canal al que se atribuye la venta
    const source = text(f, "buyer_source");
    const c = await upsertLead({ name: buyerName, phone: text(f, "buyer_phone"), email: text(f, "buyer_email"), source: source && source in SOURCE_LABEL ? source : "walk_in", intent: "buy", notify: false });
    buyerId = c.id;
  }
  let name = buyerName;
  if (buyerId && !name) {
    const { data } = await adminDb().from("customers").select("name").eq("id", buyerId).single();
    name = (data?.name as string) ?? null;
  }

  const { error } = await adminDb()
    .from("inventory_items")
    .update({ status: "sold", sale_date: saleDate, sale_price: price, buyer_customer_id: buyerId, buyer_name: name, payment_method: text(f, "payment_method"), updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };
  const sold = { ...item, sale_price: price, sale_date: saleDate };
  await logItem(id, "sale", `Vendido a ${name ?? "cliente"} por ${usd(price)}${text(f, "payment_method") ? ` (${text(f, "payment_method")})` : ""}`, user);
  await recordPurchase(buyerId, sold, user);
  await syncWebStatus(item.watch_id, "sold");

  // Intercambio: el reloj que entrega el cliente entra al inventario (costo = valor reconocido)
  const tradeBrand = text(f, "trade_brand");
  if (tradeBrand) {
    const tradeValue = money(f, "trade_value");
    const trade = await createStockItem(
      {
        acquisition: "trade",
        brand: tradeBrand,
        model: text(f, "trade_model"),
        reference: text(f, "trade_reference"),
        serial: text(f, "trade_serial"),
        comes_with: text(f, "trade_comes_with"),
        supplier_customer_id: buyerId,
        supplier_name: name,
        purchase_date: saleDate,
        cost: tradeValue,
        trade_for_item_id: item.id,
      },
      user,
      `Entrada por intercambio en la venta de ${item.sku}${tradeValue != null ? ` · valor ${usd(tradeValue)}` : ""}`
    );
    await logItem(id, "trade", `Recibido a cambio: ${tradeBrand} ${text(f, "trade_model") ?? ""} (${trade.sku})${tradeValue != null ? ` por ${usd(tradeValue)}` : ""}`.replace(/\s+/g, " "), user);
  }
  if (isOwnerStock(item.acquisition)) await logItem(id, "owed", `Pendiente de pagar al dueño: ${usd(item.cost)}`, user);
  refresh();
  return { ok: true };
}

export async function returnItem(id: string, _: unknown, f: FormData) {
  const user = await requireAdmin("inventario");
  const item = await getItem(id);
  const reason = text(f, "return_reason");
  const returnDate = date(f, "return_date") ?? new Date().toISOString().slice(0, 10);
  await adminDb().from("inventory_items").update({ status: "returned", return_date: returnDate, return_reason: reason, updated_at: new Date().toISOString() }).eq("id", id);
  const to = item.acquisition === "consignment" ? "al consignatario" : item.acquisition === "memo" ? "al dealer" : "";
  await logItem(id, "return", `Devuelto ${to}${reason ? `: ${reason}` : ""}`.trim(), user);
  if (item.supplier_customer_id) await addEvent(item.supplier_customer_id, "return", `Se le devolvió ${item.brand} ${item.model ?? ""}`.trim(), { item: id }, user);
  await syncWebStatus(item.watch_id, "draft"); // ya no está a la venta
  refresh();
  return { ok: true };
}

export async function markOwnerPaid(id: string) {
  const user = await requireAdmin("inventario");
  const item = await getItem(id);
  await adminDb().from("inventory_items").update({ owner_paid_at: new Date().toISOString().slice(0, 10) }).eq("id", id);
  await logItem(id, "owner_paid", `Pagado al dueño: $${Number(item.cost ?? 0).toLocaleString("en-US")}`, user);
  refresh();
}

// Deshacer una venta o devolución por error: vuelve a stock
export async function reopenItem(id: string) {
  const user = await requireAdmin("inventario");
  const item = await getItem(id);
  await adminDb()
    .from("inventory_items")
    .update({ status: "in_stock", sale_date: null, sale_price: null, buyer_customer_id: null, buyer_name: null, payment_method: null, return_date: null, return_reason: null, owner_paid_at: null, updated_at: new Date().toISOString() })
    .eq("id", id);
  await logItem(id, "status", `Vuelve a stock (antes: ${ITEM_STATUS[item.status]})`, user);
  await syncWebStatus(item.watch_id, "available");
  refresh();
}

// ── Relojero ──
export async function sendToServiceAction(itemId: string, f: FormData) {
  const user = await requireAdmin("inventario");
  const provider = text(f, "provider");
  if (!provider) return;
  const { sendToService } = await import("@/lib/services");
  await sendToService(itemId, { provider, work: text(f, "work"), expected_at: date(f, "expected_at") }, user);
  refresh();
}

export async function returnFromServiceAction(serviceId: string, f: FormData) {
  const user = await requireAdmin("inventario");
  const { returnFromService } = await import("@/lib/services");
  await returnFromService(serviceId, money(f, "cost"), text(f, "notes"), user);
  refresh();
}

// ── Ubicación y conteo ──
export async function setLocation(itemId: string, f: FormData) {
  const user = await requireAdmin("inventario");
  const { LOCATIONS } = await import("@/lib/locations");
  const loc = text(f, "location");
  const location = loc && loc in LOCATIONS ? loc : null;
  const note = text(f, "location_note");
  await adminDb().from("inventory_items").update({ location, location_note: note, updated_at: new Date().toISOString() }).eq("id", itemId);
  await logItem(itemId, "status", `Ubicación: ${location ? LOCATIONS[location as keyof typeof LOCATIONS] : "—"}${note ? ` · ${note}` : ""}`, user);
  refresh();
}

export async function startCountAction() {
  const user = await requireAdmin("inventario");
  const { startCount } = await import("@/lib/stock-count");
  await startCount(user);
  redirect("/admin/inventario/conteo");
}

export async function markCountedAction(countId: string, itemId: string, found: boolean) {
  await requireAdmin("inventario");
  const { markCounted } = await import("@/lib/stock-count");
  await markCounted(countId, itemId, found);
  refresh();
}

export async function finishCountAction(countId: string) {
  const user = await requireAdmin("inventario");
  const { finishCount } = await import("@/lib/stock-count");
  const { count, missing } = await finishCount(countId);
  const { notifyAdmins } = await import("@/lib/telegram");
  await notifyAdmins(
    missing.length
      ? `⚠️ <b>Conteo de inventario</b>: faltan ${missing.length} de ${count.expected.length} relojes (por ${user}). Revísalo en el CRM.`
      : `✅ <b>Conteo de inventario</b>: están los ${count.expected.length} relojes (por ${user}).`
  ).catch(() => {});
  redirect(`/admin/inventario/conteo?terminado=1&faltan=${missing.join(",")}`);
}

export async function deleteItem(id: string) {
  await requireAdmin("inventario");
  await adminDb().from("inventory_items").delete().eq("id", id);
  redirect("/admin/inventario");
}
