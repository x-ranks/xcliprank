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
// Bounded metadata-only pool, reused across a batch. Final eligibility is still
// re-read for the chosen post immediately before keeping extracted frames.
let poolCache: { until: number; rows: LabelCandidate[] } | null = null;
let loadingPool: Promise<LabelCandidate[]> | null = null;
async function candidatePool(): Promise<LabelCandidate[]> {
  if (poolCache && poolCache.until > Date.now()) return poolCache.rows;
  if (!loadingPool) loadingPool = (async () => {
    const result: LabelCandidate[] = [];
    for (let start = 0; start < 2000; start += 200) {
      const r = await rows().order("id", { ascending: false }).range(start, start + 199);
      if (r.error) throw Error("LABEL_DATABASE_READ_FAILED");
      result.push(...(r.data ?? []).flatMap(row => { const c = candidate(row); return c ? [c] : []; }));
      if ((r.data?.length ?? 0) < 200) break;
    }
    for (let i = result.length - 1; i > 0; i--) { const j = randomInt(i + 1); [result[i], result[j]] = [result[j], result[i]]; }
    poolCache = { until: Date.now() + 10 * 60 * 1000, rows: result }; return result;
  })().finally(() => { loadingPool = null; });
  return loadingPool;
}
export const labelService = createLabelService(path.join(process.cwd(), ".local-admin", "label-learning-v1"), {
  candidates: candidatePool,
  find: async id => { const r = await rows().eq("x_post_id", id).maybeSingle(); if (r.error) throw Error("LABEL_DATABASE_READ_FAILED"); return r.data ? candidate(r.data) : null; },
  prepare: prepareLabelVideo
});
