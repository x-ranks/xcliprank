import { supabaseAdmin } from "./supabase-admin";
import { calculateAdultScore, calculateCreatorScore, requiresSafetyReview } from "./adult-score";
import { classifyContent } from "./content-filter";
import { rankingScore } from "./ranking";
import { loadTierLearningModel, predictLearnedTier, blendRuleAndLearnedTier } from "./tier-learning";
import { calculateTier, applyCuratedTierFloor, type FreeTierAuthor } from "./fxtwitter-curated-tier";
import { FreeCuratedError } from "./fxtwitter-curated";
import type { FreeRegistration } from "./fxtwitter-curated-store";

export async function saveFreeCandidates(author: FreeRegistration, database = supabaseAdmin()) {
  if (!author.checkedAt || Date.now() - Date.parse(author.checkedAt) > 10 * 60000 || !author.candidates.length) {
    throw new FreeCuratedError(409, "先に無料取得を実行してください。取得結果の有効期間は10分です。");
  }
  const { data: knownAuthor, error: authorReadError } = await database.from("authors").select("*").eq("x_author_id", author.id).maybeSingle();
  if (authorReadError) throw new FreeCuratedError(503, "投稿者のDB確認に失敗しました。保存していません。");
  const context: FreeTierAuthor = { ...(knownAuthor ?? {}), curated_expected_tier: author.expectedTier };
  const duplicates = new Set<string>();
  for (const column of ["x_post_id", "media_key", "video_url"] as const) {
    const values = [...new Set(author.candidates.map(p => p[column]).filter((v): v is string => typeof v === "string" && v.length > 0))];
    // Small batches keep video URL IN queries below typical upstream URI limits.
    for (let i = 0; i < values.length; i += column === "video_url" ? 3 : 20) {
      const { data, error } = await database.from("posts").select("x_post_id," + column).in(column, values.slice(i, i + (column === "video_url" ? 3 : 20)));
      if (error) throw new FreeCuratedError(503, "保存済み動画のDB確認に失敗しました。既存データを保護して停止しました。");
      for (const row of data ?? []) {
        for (const candidate of author.candidates) if (candidate[column] === (row as any)[column]) duplicates.add(candidate.x_post_id);
      }
    }
  }
  // This reads the same teacher model as regular collection. Failure stops this experimental save.
  const model = await loadTierLearningModel();
  const now = new Date().toISOString(), seenMedia = new Set<string>(), seenVideos = new Set<string>();
  const unique = author.candidates.filter(post => {
    if (duplicates.has(post.x_post_id) || (post.media_key && seenMedia.has(post.media_key)) || (post.video_url && seenVideos.has(post.video_url))) return false;
    if (post.media_key) seenMedia.add(post.media_key); if (post.video_url) seenVideos.add(post.video_url); return true;
  });
  const rows = unique.map(candidate => {
    const { durationSeconds: _duration, videoCount: _count, ...post } = candidate;
    const adultScore = calculateAdultScore(post.text, post.possibly_sensitive), creatorScore = calculateCreatorScore(post.text);
    const content = classifyContent(post.text), reviewRequired = requiresSafetyReview(post.text);
    const rule = applyCuratedTierFloor(calculateTier({ possibly_sensitive: post.possibly_sensitive, adult_score: adultScore,
      creator_score: creatorScore, review_required: reviewRequired }, context), context, content.category);
    const learned = content.category === "PASS" ? predictLearnedTier(model, { authorId: author.id, adultScore, creatorScore, possiblySensitive: post.possibly_sensitive }) : null;
    const tier = content.category === "PASS" ? blendRuleAndLearnedTier(rule, learned) : rule;
    return { ...post, adult_score: adultScore, creator_score: creatorScore, review_required: reviewRequired,
      author_stats_counted: false, effective_adult_score: tier.score, adult_tier: tier.tier,
      content_category: content.category, content_filter_score: content.score, content_filter_reason: content.reason,
      collection_source: "curated", last_seen_at: now, is_visible: false, moderation_blocked: content.category !== "PASS",
      score: rankingScore({ views: post.views, likes: post.likes, reposts: post.reposts, replies: post.replies, createdAt: post.created_at }) };
  });
  if (!rows.length) return { saved: 0, duplicates: author.candidates.length, excluded: 0, hidden: true };
  // New authors never join the paid collector. Existing curated settings/cursors/stats remain untouched.
  const { error: authorError } = await database.from("authors").upsert({ x_author_id: author.id, username: author.username,
    name: author.name, is_curated: false, last_seen_at: now }, { onConflict: "x_author_id", ignoreDuplicates: true });
  if (authorError) throw new FreeCuratedError(503, "投稿者の候補登録に失敗しました。");
  // ON CONFLICT DO NOTHING also protects existing manual tiers and removal flags from concurrent inserts.
  const { data: saved, error } = await database.from("posts").upsert(rows, { onConflict: "x_post_id", ignoreDuplicates: true }).select("x_post_id");
  if (error) throw new FreeCuratedError(503, "動画候補のDB保存に失敗しました。再取得せず再試行できます。");
  const savedIds = new Set((saved ?? []).map((row: any) => String(row.x_post_id)));
  return { saved: savedIds.size, duplicates: author.candidates.length - savedIds.size,
    excluded: rows.filter(row => savedIds.has(row.x_post_id) && row.content_category !== "PASS").length, hidden: true };
}
