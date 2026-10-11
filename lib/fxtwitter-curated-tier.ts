// Same rule tier calculation as the existing curated collector; no paid collection import at runtime.
export type FreeTierAuthor = {
  adult_score?: number | null; creator_score?: number | null; sensitive_ratio?: number | null;
  cumulative_posts?: number | null; cumulative_video_posts?: number | null; video_ratio?: number | null;
  review_required?: boolean | null; curated_expected_tier: "S" | "A";
};
type PendingPost = {
  possibly_sensitive: boolean | null;
  adult_score: number;
  creator_score: number;
  review_required: boolean;
};

export function calculateTier(post: PendingPost, author: FreeTierAuthor) {
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
  author: FreeTierAuthor,
  contentCategory: string
) {
  if (contentCategory !== "PASS" || !["NONE", "D", "D+"].includes(result.tier)) {
    return result;
  }
  return author.curated_expected_tier === "S"
    ? { score: 0.67, tier: "B" }
    : { score: 0.55, tier: "C" };
}

