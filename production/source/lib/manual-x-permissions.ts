import { createHash } from "node:crypto";
import { readManualState, type ManualPlacement } from "./manual-ranking";
import { supabaseAdmin } from "./supabase-admin";
import { isUnavailablePost } from "./post-status";

type Row = Record<string, any>;
// This is a second, post-specific permission, not author-wide curation.
// A current database row, current author state, current video URL and removal
// state must all still agree; manual approval cannot restore a hidden row.
export function manualXPermitted(row: Row, entries: readonly ManualPlacement[], author: Row | undefined, blocked: ReadonlySet<string>) {
  if (!author || author.review_required === true || ["paused", "removed", "unavailable"].includes(author.curated_status) ||
      isUnavailablePost(row, blocked) || blocked.has("name:" + String(author.username ?? "").toLowerCase()) ||
      row.is_visible !== true || row.moderation_blocked !== false || row.review_required !== false || row.content_category !== "PASS" ||
      typeof row.video_url !== "string") return false;
  const hash = createHash("sha256").update(row.video_url).digest("hex");
  return entries.some(entry => entry.xApproval?.postId === String(row.x_post_id) &&
    entry.xApproval.authorId === String(row.author_id) && entry.xApproval.videoHash === hash);
}
export async function eligibleManualXIds(rows: Row[], blocked: ReadonlySet<string>) {
  if (!rows.length) return new Set<string>();
  const { entries } = await readManualState();
  const matches = rows.filter(row => entries.some(entry => entry.xApproval?.postId === String(row.x_post_id)));
  if (!matches.length) return new Set<string>();
  const ids = [...new Set(matches.map(row => String(row.author_id)))];
  const result = await supabaseAdmin().from("authors").select("x_author_id,username,curated_status,review_required").in("x_author_id", ids).limit(100);
  if (result.error) throw Error("MANUAL_APPROVAL_AUTHOR_UNAVAILABLE");
  const authors = new Map((result.data ?? []).map((author: Row) => [String(author.x_author_id), author]));
  return new Set(matches.filter(row => manualXPermitted(row, entries, authors.get(String(row.author_id)), blocked)).map(row => String(row.x_post_id)));
}
