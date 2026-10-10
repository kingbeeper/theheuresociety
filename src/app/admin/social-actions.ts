"use server";

import { refresh } from "next/cache";
import { after } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";

// Engagement en redes: ideas, comentarios y competencia (permiso «redes»)

export async function generateIdeasAction() {
  const user = await requireAdmin("redes");
  const { generateContentPlan } = await import("@/lib/social-growth");
  await generateContentPlan(user);
  refresh();
}

export async function ideaStatusAction(id: string, status: "approved" | "dismissed" | "posted") {
  await requireAdmin("redes");
  const { setIdeaStatus } = await import("@/lib/social-ideas");
  await setIdeaStatus(id, status);
  refresh();
}

// Video promocional desde una idea: se genera en segundo plano (3-4 min) y aparece en su vista previa
export async function ideaVideoAction(watchId: string, f: FormData) {
  await requireAdmin("redes");
  const { promoConfigured, startPromoVideo, pollPromoVideo } = await import("@/lib/promo-video");
  if (!promoConfigured()) throw new Error("Falta la clave de la API de Higgsfield");
  const id = await startPromoVideo(watchId, null, String(f.get("opening") ?? "auto"), String(f.get("closing") ?? "auto"));
  after(() => pollPromoVideo(id, 30_000));
  refresh();
}

export async function replyCommentAction(id: string, f: FormData) {
  await requireAdmin("redes");
  const text = String(f.get("reply") ?? "").trim();
  if (!text) return;
  const { replyComment } = await import("@/lib/social-growth");
  await replyComment(id, text);
  refresh();
}

export async function ignoreCommentAction(id: string) {
  await requireAdmin("redes");
  const { adminDb } = await import("@/lib/supabase");
  await adminDb().from("social_comments").update({ replied_at: new Date().toISOString(), reply_text: "(sin respuesta)" }).eq("id", id);
  refresh();
}

export async function suggestRepliesAction() {
  await requireAdmin("redes");
  const { getSettings } = await import("@/lib/meta");
  const g = await import("@/lib/social-growth");
  await g.syncComments(await getSettings());
  await g.suggestReplies();
  refresh();
}

export async function saveEngagementSettings(f: FormData) {
  await requireAdmin("redes");
  const { saveSettings, getSettings } = await import("@/lib/meta");
  const clean = (k: string) => String(f.get(k) ?? "").trim() || null;
  await saveSettings({ comment_keywords: clean("comment_keywords"), competitors: clean("competitors") });
  // Nada más guardar la competencia, se toma su primera foto
  const { snapshotCompetitors } = await import("@/lib/social-growth");
  await snapshotCompetitors(await getSettings()).catch(() => {});
  refresh();
}
