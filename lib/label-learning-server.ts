import path from "node:path";
import { randomInt } from "node:crypto";
import { supabaseAdmin } from "./supabase-admin";
import { createLabelService, LabelCandidate } from "./label-learning-service";
import { allowedLabelVideo, prepareLabelVideo } from "./label-learning-video";
const fields = "x_post_id,author_id,author_username,video_url";
function rows() {
  return supabaseAdmin().from("posts").select(fields).eq("is_visible", true).eq("moderation_blocked", false).eq("review_required", false).eq("content_category", "PASS").not("video_url", "is", null).or("manual_tier.not.in.(NONE,X),and(manual_tier.is.null,adult_tier.not.in.(NONE,X))");
}
function candidate(row: { x_post_id: unknown; author_id: unknown; author_username: unknown; video_url: unknown }): LabelCandidate | null {
  if (typeof row.x_post_id !== "string" || !/^\d{1,25}$/.test(row.x_post_id) || typeof row.video_url !== "string" || !allowedLabelVideo(row.video_url)) return null;
  return { postId: row.x_post_id, author: typeof row.author_username === "string" ? row.author_username : null, authorKey: typeof row.author_id === "string" ? row.author_id : null, url: row.video_url };
}
export const labelService = createLabelService(path.join(process.cwd(), ".local-admin", "label-learning-v1"), {
  candidates: async () => {
    // Bounded metadata query only; do not scan all posts or modify any existing DB table.
    const r = await rows().order("id", { ascending: false }).limit(200); if (r.error) throw Error("LABEL_DATABASE_READ_FAILED");
    const result = (r.data ?? []).flatMap(row => { const c = candidate(row); return c ? [c] : []; });
    for (let i = result.length - 1; i > 0; i--) { const j = randomInt(i + 1); [result[i], result[j]] = [result[j], result[i]]; } return result;
  },
  find: async id => { const r = await rows().eq("x_post_id", id).maybeSingle(); if (r.error) throw Error("LABEL_DATABASE_READ_FAILED"); return r.data ? candidate(r.data) : null; },
  prepare: prepareLabelVideo
});
