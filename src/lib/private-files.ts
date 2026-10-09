import "server-only";
import { adminDb } from "./supabase";

// Archivos privados (firmas, fotos de identificación): bucket sin acceso público.
// Solo el servidor los lee, o los muestra con un enlace que caduca en segundos.

const BUCKET = "private";

export async function uploadPrivate(path: string, bytes: Uint8Array | ArrayBuffer, contentType: string) {
  const { error } = await adminDb().storage.from(BUCKET).upload(path, bytes, { contentType, upsert: true });
  if (error) throw error;
  return path;
}

export async function downloadPrivate(path: string) {
  const { data, error } = await adminDb().storage.from(BUCKET).download(path);
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
}

export async function privateUrl(path: string, seconds = 60) {
  const { data } = await adminDb().storage.from(BUCKET).createSignedUrl(path, seconds);
  return data?.signedUrl ?? null;
}
