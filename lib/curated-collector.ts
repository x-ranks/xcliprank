import { activePersonalBundle, applyPersonalTier } from "./tier-personal-store";
import { calculateAdultScore, calculateCreatorScore, requiresSafetyReview } from "./adult-score";
import { classifyContent } from "./content-filter";
import { errorMessage } from "./error-message";
import { rankingScore } from "./ranking";
import { supabaseAdmin } from "./supabase-admin";
import {
  blendRuleAndLearnedTier,
  loadTierLearningModel,
  predictLearnedTier,
} from "./tier-learning";
import { fetchUserTimelineVideoPosts, searchRecentVideoPosts } from "./x";

export type CuratedCollectionMode = "initial" | "incremental";

export type CuratedAuthor = {
  x_author_id: string;
  username: string;
  adult_score: number | null;
  creator_score: number | null;
  sensitive_ratio: number | null;
  cumulative_posts: number | null;
  cumulative_video_posts: number | null;
  video_ratio: number | null;
  review_required: boolean | null;
  curated_backfill_status: string | null;
  curated_expected_tier: "S" | "A" | null;
  curated_last_post_id: string | null;
  curated_total_fetched: number | null;
  curated_total_saved: number | null;
  curated_total_duplicates: number | null;
  curated_total_safety_excluded: number | null;
  curated_total_content_excluded: number | null;
  curated_total_accepted: number | null;
  curated_unavailable_failure_count: number | null;
  curated_unavailable_since: string | null;
};

type PendingPost = {
  possibly_sensitive: boolean | null;
  adult_score: number;
  creator_score: number;
  review_required: boolean;
};

export function calculateTier(post: PendingPost, author: CuratedAuthor) {
  const sensitive = post.possibly_sensitive === true;
  const postAdultScore = Number(post.adult_score || 0);
  const postCreatorScore = Number(post.creator_score || 0);
  const authorAdultScore = Number(author.adult_score || 0);
  const authorCreatorScore = Number(author.creator_score || 0);
  const sensitiveRatio = Number(author.sensitive_ratio || 0);
  const cumulativePosts = Number(author.cumulative_posts || 0);
  const cumulativeVideoPosts = Number(author.cumulative_video_posts || 0);
  const videoRatio = Number(author.video_ratio || 0);

  if (post.review_required || author.review_required) return { score: 0, tier: "X" };
  if (sensitive && authorCreatorScore >= 0.7 && sensitiveRatio >= 0.8 && cumulativePosts >= 5 && videoRatio >= 0.8) return { score: 0.95, tier: "S" };
  if (sensitive && postCreatorScore >= 0.5 && authorCreatorScore >= 0.5) return { score: 0.92, tier: "S" };
  if (sensitive && authorCreatorScore >= 0.6 && sensitiveRatio >= 0.7 && cumulativePosts >= 3) return { score: 0.86, tier: "A+" };
  if (sensitive && authorCreatorScore >= 0.5 && cumulativePosts >= 2) return { score: 0.8, tier: "A" };
  if (sensitive && postCreatorScore >= 0.25) return { score: 0.78, tier: "A" };
  if (sensitive && authorAdultScore >= 0.55 && cumulativePosts >= 5 && cumulativeVideoPosts >= 4 && videoRatio >= 0.8) return { score: 0.72, tier: "B+" };
  if (sensitive && sensitiveRatio >= 0.8 && cumulativePosts >= 3) return { score: 0.67, tier: "B" };
  if (sensitive && postAdultScore > 0.42) return { score: 0.63, tier: "B" };
  if (sensitive) return { score: 0.55, tier: "C" };
  if (postAdultScore >= 0.7) return { score: 0.5, tier: "D+" };
  if (authorCreatorScore >= 0.6 && cumulativePosts >= 5) return { score: 0.42, tier: "D" };
  if (postCreatorScore >= 0.5) return { score: 0.35, tier: "D" };
  return { score: 0, tier: "NONE" };
}

export function applyCuratedTierFloor(
  result: { score: number; tier: string },
  author: CuratedAuthor,
  contentCategory: string
) {
  if (contentCategory !== "PASS" || !["NONE", "D", "D+"].includes(result.tier)) {
    return result;
  }
  return author.curated_expected_tier === "S"
    ? { score: 0.67, tier: "B" }
    : { score: 0.55, tier: "C" };
}

function newestPostId(ids: string[]) {
  return ids.reduce<string | null>((newest, id) => {
    if (!newest) return id;
    try {
      return BigInt(id) > BigInt(newest) ? id : newest;
    } catch {
      return id > newest ? id : newest;
    }
  }, null);
}

async function existingValues(column: "x_post_id" | "media_key" | "video_url", values: string[]) {
  if (values.length === 0) return new Set<string>();
  const supabase = supabaseAdmin();
  const { data, error } = await supabase.from("posts").select(column).in(column, values);
  if (error) throw error;
  return new Set((data ?? []).map((row) => String((row as Record<string, unknown>)[column] ?? "")).filter(Boolean));
}

export async function collectCuratedAuthor(author: CuratedAuthor, mode: CuratedCollectionMode) {
  const supabase = supabaseAdmin();
  const now = new Date().toISOString();
  // 学習データの一時的な取得失敗で動画収集全体を止めない。
  const tierLearningModel = await loadTierLearningModel().catch((error) => {
    console.error(
      "Tier learning model load failed:",
      errorMessage(error, "学習モデル取得失敗")
    );
    return null;
  });

  await supabase.from("authors").update({
    curated_backfill_status: mode === "initial" ? "running" : author.curated_backfill_status,
    curated_last_error: null,
  }).eq("x_author_id", author.x_author_id);

  try {
    // 初回はタイムラインの最新200投稿、以後は前回以降の動画を最大200件取得する。
    const fetched = mode === "initial"
      ? await fetchUserTimelineVideoPosts(author.x_author_id, 200, "curated_initial")
      : await searchRecentVideoPosts(
          `from:${author.username} has:videos -is:retweet`,
          200,
          { sinceId: author.curated_last_post_id },
          "curated_incremental"
        );
    const postIds = fetched.map((post) => post.x_post_id);
    const mediaKeys = fetched.map((post) => post.media_key).filter((value): value is string => Boolean(value));
    const videoUrls = fetched.map((post) => post.video_url).filter((value): value is string => Boolean(value));
    const [existingPosts, existingMedia, existingVideos] = await Promise.all([
      existingValues("x_post_id", postIds),
      existingValues("media_key", mediaKeys),
      existingValues("video_url", videoUrls),
    ]);

    const seenPosts = new Set(existingPosts);
    const seenMedia = new Set(existingMedia);
    const seenVideos = new Set(existingVideos);
    let duplicates = 0;
    const unique = fetched.filter((post) => {
      const duplicate = seenPosts.has(post.x_post_id) ||
        Boolean(post.media_key && seenMedia.has(post.media_key)) ||
        Boolean(post.video_url && seenVideos.has(post.video_url));
      if (duplicate) {
        duplicates += 1;
        return false;
      }
      seenPosts.add(post.x_post_id);
      if (post.media_key) seenMedia.add(post.media_key);
      if (post.video_url) seenVideos.add(post.video_url);
      return true;
    });

    const personalModel = await activePersonalBundle();
    let learnedTierApplied = 0;
    const rows = [];
    for (const post of unique) {
      const adultScore = calculateAdultScore(post.text ?? "", post.possibly_sensitive ?? false);
      const creatorScore = calculateCreatorScore(post.text ?? "");
      const reviewRequired = requiresSafetyReview(post.text ?? "");
      const content = classifyContent(post.text ?? "");
      const ruleTier = applyCuratedTierFloor(calculateTier({
        possibly_sensitive: post.possibly_sensitive,
        adult_score: adultScore,
        creator_score: creatorScore,
        review_required: reviewRequired,
      }, author), author, content.category);
      const learnedPrediction = content.category === "PASS"
        ? predictLearnedTier(tierLearningModel, {
            authorId: post.author_id ? String(post.author_id) : null,
            adultScore,
            creatorScore,
            possiblySensitive: post.possibly_sensitive === true,
          })
        : null;
      if (learnedPrediction) learnedTierApplied += 1;
      const metadataTier = content.category === "PASS"
        ? blendRuleAndLearnedTier(ruleTier, learnedPrediction)
        : ruleTier;

      const tier = content.category === "PASS" && !reviewRequired
        ? await applyPersonalTier(metadataTier, {id: post.x_post_id, video: post.video_url ?? null}, personalModel, consumeVisualBudget())
        : metadataTier;
      rows.push({
        ...post,
        adult_score: adultScore,
        creator_score: creatorScore,
        review_required: reviewRequired,
        author_stats_counted: false,
        effective_adult_score: tier.score,
        adult_tier: tier.tier,
        content_category: content.category,
        content_filter_score: content.score,
        content_filter_reason: content.reason,
        collection_source: "curated",
        last_seen_at: now,
        score: rankingScore({
          views: post.views,
          likes: post.likes,
          reposts: post.reposts,
          replies: post.replies,
          createdAt: post.created_at,
        }),
      });
    }

    if (rows.length > 0) {
      const { error: postError } = await supabase.from("posts").upsert(rows, { onConflict: "x_post_id" });
      if (postError) throw postError;
      const { error: snapshotError } = await supabase.from("metric_snapshots").insert(rows.map((post) => ({
        x_post_id: post.x_post_id,
        measured_at: now,
        views: post.views,
        likes: post.likes,
        reposts: post.reposts,
        replies: post.replies,
        score: post.score,
      })));
      if (snapshotError) throw snapshotError;
    }

    const safetyExcluded = rows.filter((post) => post.content_category === "SAFETY_REVIEW").length;
    const contentExcluded = rows.filter((post) => !["PASS", "SAFETY_REVIEW"].includes(post.content_category)).length;
    const accepted = rows.filter((post) => post.content_category === "PASS" && ["S", "A+", "A", "B+", "B", "C"].includes(post.adult_tier)).length;
    const latestId = newestPostId(postIds);
    const { error: authorError } = await supabase.from("authors").update({
      curated_backfill_status: mode === "initial" ? "completed" : author.curated_backfill_status,
      curated_backfill_completed_at: mode === "initial" ? now : undefined,
      curated_last_collected_at: now,
      curated_last_post_id: latestId,
      curated_total_fetched: Number(author.curated_total_fetched || 0) + fetched.length,
      curated_total_saved: Number(author.curated_total_saved || 0) + rows.length,
      curated_total_duplicates: Number(author.curated_total_duplicates || 0) + duplicates,
      curated_total_safety_excluded: Number(author.curated_total_safety_excluded || 0) + safetyExcluded,
      curated_total_content_excluded: Number(author.curated_total_content_excluded || 0) + contentExcluded,
      curated_total_accepted: Number(author.curated_total_accepted || 0) + accepted,
      curated_unavailable_failure_count: 0,
      curated_unavailable_since: null,
      curated_last_error: null,
      last_checked_at: now,
    }).eq("x_author_id", author.x_author_id);
    if (authorError) throw authorError;

    return {
      author: author.username,
      mode,
      fetched: fetched.length,
      saved: rows.length,
      duplicates,
      safetyExcluded,
      contentExcluded,
      accepted,
      mosaicExcluded: 0,
      learnedTierApplied,
      tierLearningSamples: tierLearningModel?.samples.length ?? 0,
      tierLearningRefreshedAt: tierLearningModel?.trainedAt ?? null,
      latestPostId: latestId,
      completedAt: now,
    };
  } catch (error) {
    const message = errorMessage(error, "Collection failed");
    const normalized = message.toLowerCase();
    const accountUnavailable = [
      '"reason":"suspended"',
      "user has been suspended",
      "account is suspended",
      "user not found",
      "could not find user",
      "user does not exist",
      "resource-not-found"
    ].some((signal) => normalized.includes(signal));
    const unavailableFailures = accountUnavailable
      ? Number(author.curated_unavailable_failure_count || 0) + 1
      : Number(author.curated_unavailable_failure_count || 0);
    const automaticallyStopped = accountUnavailable && unavailableFailures >= 3;

    await supabase.from("authors").update({
      curated_backfill_status: mode === "initial" ? "failed" : author.curated_backfill_status,
      curated_last_error: message.slice(0, 500),
      curated_unavailable_failure_count: unavailableFailures,
      curated_unavailable_since: accountUnavailable
        ? author.curated_unavailable_since ?? now
        : author.curated_unavailable_since,
      curated_status: automaticallyStopped ? "unavailable" : undefined,
    }).eq("x_author_id", author.x_author_id);
    throw error;
  }
}

export const CURATED_AUTHOR_SELECT = [
  "x_author_id", "username", "name", "adult_score", "creator_score", "sensitive_ratio",
  "cumulative_posts", "cumulative_video_posts", "video_ratio", "review_required",
  "is_curated", "curated_status", "curated_expected_tier", "curated_added_at",
  "curated_backfill_status", "curated_backfill_completed_at", "curated_last_collected_at",
  "curated_last_post_id", "curated_total_fetched", "curated_total_saved",
  "curated_total_duplicates", "curated_total_safety_excluded", "curated_total_content_excluded",
  "curated_total_accepted", "curated_last_error", "curated_unavailable_failure_count",
  "curated_unavailable_since"
].join(",");

let visualBudgetUntil = 0, visualBudgetRemaining = 0;
function consumeVisualBudget() {
  if (process.env.XCLIP_VISUAL_COLLECTION !== "1") return false;
  if (Date.now() > visualBudgetUntil) { visualBudgetUntil = Date.now() + 60000; visualBudgetRemaining = 4; }
  if (visualBudgetRemaining <= 0) return false;
  visualBudgetRemaining--; return true;
}
