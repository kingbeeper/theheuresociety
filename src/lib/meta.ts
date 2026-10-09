import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { adminDb } from "./supabase";

// Conexión con Meta para Instagram y la página de Facebook (métricas, DM, comentarios).
// Usa la misma app de Meta que WhatsApp. La conexión se hace desde el CRM (/admin/redes) y se
// guarda en integration_settings.

export const GRAPH = "https://graph.facebook.com/v26.0";
export const META_APP_ID = process.env.NEXT_PUBLIC_META_APP_ID ?? "";
export const META_APP_SECRET = process.env.META_APP_SECRET ?? process.env.WHATSAPP_APP_SECRET ?? "";
export const META_VERIFY_TOKEN = process.env.META_VERIFY_TOKEN ?? process.env.WHATSAPP_VERIFY_TOKEN ?? "";

// Permisos que se piden al conectar (métricas, mensajes y comentarios de Instagram y Facebook)
export const META_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_read_user_content",
  "pages_manage_metadata",
  "pages_messaging",
  "read_insights",
  "instagram_basic",
  "instagram_manage_insights",
  "instagram_manage_messages",
  "instagram_manage_comments",
  "business_management",
];

// ───────────────────────────── Ajustes guardados ─────────────────────────────
export type SocialSettings = {
  page_id?: string;
  page_name?: string;
  page_token?: string;
  ig_id?: string;
  ig_username?: string;
  connected_at?: string;
  connected_by?: string;
  bot_dm?: string; // "on" | "off": el bot responde los DM de Instagram y Messenger
  comment_reply?: string; // "on" | "off": respuesta privada automática a comentarios de interés
  comment_reply_text?: string;
};

export async function getSettings(): Promise<SocialSettings> {
  const { data } = await adminDb().from("integration_settings").select("key, value");
  return Object.fromEntries((data ?? []).map((r) => [r.key, r.value])) as SocialSettings;
}

export async function saveSettings(values: Partial<Record<keyof SocialSettings, string | null>>) {
  const db = adminDb();
  const now = new Date().toISOString();
  for (const [key, value] of Object.entries(values)) {
    if (value == null) await db.from("integration_settings").delete().eq("key", key);
    else await db.from("integration_settings").upsert({ key, value, updated_at: now }, { onConflict: "key" });
  }
}

export const DEFAULT_COMMENT_REPLY =
  "¡Hola! Gracias por su interés. Le escribimos por aquí con todos los detalles: ¿qué le gustaría saber de la pieza? / Hi! Thank you for your interest — what would you like to know about this piece?";

// ───────────────────────────── Llamadas a la API ─────────────────────────────
export class GraphError extends Error {
  constructor(message: string, readonly code?: number) {
    super(message);
  }
}

export async function graph<T = Record<string, unknown>>(
  path: string,
  token: string,
  params: Record<string, string | number | undefined> = {},
  init: { method?: "GET" | "POST" | "DELETE"; body?: unknown } = {}
): Promise<T> {
  const url = new URL(path.startsWith("http") ? path : `${GRAPH}/${path.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, String(v));
  url.searchParams.set("access_token", token);
  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers: init.body ? { "Content-Type": "application/json" } : undefined,
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; code?: number } };
  if (!res.ok || json.error) throw new GraphError(json.error?.message ?? `Meta ${res.status}`, json.error?.code);
  return json;
}

// Recorre todas las páginas de resultados de un listado de Meta
export async function graphAll<T>(path: string, token: string, params: Record<string, string | number> = {}, max = 200) {
  const out: T[] = [];
  let next: string | undefined;
  let page = await graph<{ data: T[]; paging?: { next?: string } }>(path, token, params);
  for (;;) {
    out.push(...(page.data ?? []));
    next = page.paging?.next;
    if (!next || out.length >= max) break;
    page = await graph<{ data: T[]; paging?: { next?: string } }>(next, token);
  }
  return out.slice(0, max);
}

// ───────────────────────────── Webhooks ─────────────────────────────
// Meta firma cada aviso con el secreto de la app (X-Hub-Signature-256)
export function validMetaSignature(rawBody: string, signature: string | null) {
  if (!META_APP_SECRET) return process.env.NODE_ENV !== "production";
  if (!signature?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", META_APP_SECRET).update(rawBody, "utf8").digest();
  const given = Buffer.from(signature.slice(7), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
