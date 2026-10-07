import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secretKey = process.env.SUPABASE_SECRET_KEY;

export const PHOTO_BUCKET = "watches";

// La web funciona sin Supabase (usa el inventario de respaldo) hasta que se configuren las claves
export const supabaseConfigured = Boolean(url && publishableKey);

const options = { auth: { persistSession: false, autoRefreshToken: false } };

// Lectura pública: respeta las reglas de seguridad (solo relojes publicados)
export function publicDb(): SupabaseClient {
  if (!url || !publishableKey) throw new Error("Supabase no está configurado");
  return createClient(url, publishableKey, options);
}

// Acceso completo para el robot. Nunca se envía al navegador.
export function adminDb(): SupabaseClient {
  if (!url || !secretKey) throw new Error("Falta SUPABASE_SECRET_KEY");
  return createClient(url, secretKey, options);
}
