import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "../../../lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REVIEW_CATEGORIES = [
  "AI_GENERATED",
  "SOFT_GRAVURE",
  "PROMO",
  "OUT_OF_SCOPE",
] as const;

type ReviewCategory = (typeof REVIEW_CATEGORIES)[number];
type Verdict = "correct" | "false_positive";
type KeepTier = "S" | "A" | "B" | "C" | "D";

type ReviewPost = {
  id: number;
  x_post_id: string;
  author_username: string | null;
  text: string | null;
  created_at: string | null;
  x_url: string | null;
  preview_image_url: string | null;
  video_url: string;
  content_category: ReviewCategory;
  content_filter_score: number | null;
  content_filter_reason: string | null;
  possibly_sensitive: boolean | null;
  adult_tier: string | null;
};

type ExistingPost = {
  id: number;
  manual_tier: string | null;
  content_category: string | null;
};

const TARGET_COUNTS: Record<ReviewCategory, number> = {
  AI_GENERATED: 8,
  SOFT_GRAVURE: 8,
  PROMO: 8,
  OUT_OF_SCOPE: 6,
};
const CANDIDATE_LIMIT = 120;
const KEEP_TIERS: readonly KeepTier[] = ["S", "A", "B", "C", "D"];
const CATEGORY_TO_MANUAL: Record<ReviewCategory, string> = {
  AI_GENERATED: "ai_generated",
  SOFT_GRAVURE: "soft_gravure",
  PROMO: "promo_sample",
  OUT_OF_SCOPE: "out_of_scope",
};
const POST_FIELDS = [
  "id",
  "x_post_id",
  "author_username",
  "text",
  "created_at",
  "x_url",
  "preview_image_url",
  "video_url",
  "content_category",
  "content_filter_score",
  "content_filter_reason",
  "possibly_sensitive",
  "adult_tier",
].join(",");

function headers() {
  return { "Cache-Control": "no-store" };
}

function isAuthorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  return Boolean(
    secret && request.headers.get("authorization") === `Bearer ${secret}`,
  );
}

function isReviewCategory(value: unknown): value is ReviewCategory {
  return REVIEW_CATEGORIES.includes(value as ReviewCategory);
}

function scoreBand(score: number | null) {
  if (score === null) return "unknown";
  if (score < 0.7) return "low";
  if (score < 0.9) return "middle";
  return "high";
}

function dateBand(createdAt: string | null, dates: number[]) {
  if (!createdAt || dates.length < 2) return "unknown";
  const timestamp = Date.parse(createdAt);
  if (!Number.isFinite(timestamp)) return "unknown";
  const min = dates[0];
  const max = dates[dates.length - 1];
  if (max === min) return "same";
  const position = (timestamp - min) / (max - min);
  return position < 1 / 3 ? "old" : position < 2 / 3 ? "middle" : "recent";
}

function selectDiverse(posts: ReviewPost[], count: number) {
  const remaining = [...posts];
  const selected: ReviewPost[] = [];
  const authors = new Set<string>();
  const reasons = new Set<string>();
  const scoreBands = new Set<string>();
  const dateBands = new Set<string>();
  const dates = posts
    .map((post) => Date.parse(post.created_at ?? ""))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  while (selected.length < count && remaining.length > 0) {
    let bestIndex = 0;
    let bestWeight = -1;
    for (let index = 0; index < remaining.length; index++) {
      const post = remaining[index];
      const author = post.author_username?.toLowerCase() ?? `post:${post.id}`;
      const reason = post.content_filter_reason ?? "";
      const score = scoreBand(post.content_filter_score);
      const date = dateBand(post.created_at, dates);
      const weight =
        (authors.has(author) ? 0 : 100) +
        (reasons.has(reason) ? 0 : 20) +
        (scoreBands.has(score) ? 0 : 10) +
        (dateBands.has(date) ? 0 : 5) +
        index / Math.max(remaining.length, 1);
      if (weight > bestWeight) {
        bestWeight = weight;
        bestIndex = index;
      }
    }
    const [post] = remaining.splice(bestIndex, 1);
    selected.push(post);
    authors.add(post.author_username?.toLowerCase() ?? `post:${post.id}`);
    reasons.add(post.content_filter_reason ?? "");
    scoreBands.add(scoreBand(post.content_filter_score));
    dateBands.add(dateBand(post.created_at, dates));
  }
  return selected;
}

function errorMessage(status: number, error: string) {
  return NextResponse.json(
    { success: false, error },
    { status, headers: headers() },
  );
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) return errorMessage(401, "Unauthorized");

  try {
    const supabase = supabaseAdmin();
    const results = await Promise.all(
      REVIEW_CATEGORIES.map(async (category) => {
        const [{ data, error }, { count, error: countError }] =
          await Promise.all([
            supabase
              .from("posts")
              .select(POST_FIELDS)
              .is("manual_tier", null)
              .eq("is_visible", true)
              .not("video_url", "is", null)
              .eq("content_category", category)
              .order("created_at", { ascending: false })
              .limit(CANDIDATE_LIMIT),
            supabase
              .from("posts")
              .select("id", { count: "exact", head: true })
              .is("manual_tier", null)
              .eq("is_visible", true)
              .not("video_url", "is", null)
              .eq("content_category", category),
          ]);
        if (error || countError) throw error ?? countError;
        const rows = (data ?? []) as unknown as ReviewPost[];
        const candidates = rows.filter(
          (post): post is ReviewPost =>
            isReviewCategory(post.content_category) &&
            typeof post.video_url === "string",
        );
        return {
          category,
          posts: selectDiverse(candidates, TARGET_COUNTS[category]),
          remaining: count ?? 0,
        };
      }),
    );

    const posts = results.flatMap((result) => result.posts);
    const distribution = Object.fromEntries(
      results.map((result) => [result.category, result.posts.length]),
    );
    const remainingByCategory = Object.fromEntries(
      results.map((result) => [result.category, result.remaining]),
    );

    return NextResponse.json(
      {
        success: true,
        count: posts.length,
        distribution,
        remaining_by_category: remainingByCategory,
        posts,
      },
      { headers: headers() },
    );
  } catch {
    return errorMessage(500, "Failed to load content filter review posts");
  }
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) return errorMessage(401, "Unauthorized");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorMessage(400, "Invalid JSON body");
  }
  const input = body && typeof body === "object"
    ? body as { postId?: unknown; verdict?: unknown; keepTier?: unknown }
    : {};
  if (
    (typeof input.postId !== "number" && typeof input.postId !== "string") ||
    String(input.postId).trim() === ""
  ) {
    return errorMessage(400, "postId is required");
  }
  if (input.verdict !== "correct" && input.verdict !== "false_positive") {
    return errorMessage(400, "verdict must be correct or false_positive");
  }
  const verdict: Verdict = input.verdict;
  if (
    verdict === "false_positive" &&
    !KEEP_TIERS.includes(input.keepTier as KeepTier)
  ) {
    return errorMessage(400, "keepTier must be S, A, B, C or D");
  }

  try {
    const supabase = supabaseAdmin();
    const { data: existing, error: readError } = await supabase
      .from("posts")
      .select("id,manual_tier,content_category")
      .eq("id", input.postId)
      .maybeSingle();
    if (readError) throw readError;
    if (!existing) return errorMessage(404, "Post not found");
    const post = existing as ExistingPost;
    if (post.manual_tier !== null) {
      return errorMessage(409, "Post has already been reviewed");
    }
    if (!isReviewCategory(post.content_category)) {
      return errorMessage(400, "Post category is not reviewable");
    }

    const values = verdict === "correct"
      ? {
          manual_tier: "X",
          manual_category: CATEGORY_TO_MANUAL[post.content_category],
        }
      : {
          manual_tier: input.keepTier as KeepTier,
          manual_category: null,
        };
    const reviewedAt = new Date().toISOString();
    const note =
      `content-filter review; verdict=${verdict}; predicted=${post.content_category}`;
    const { data: updated, error: updateError } = await supabase
      .from("posts")
      .update({
        ...values,
        manual_reviewed_at: reviewedAt,
        manual_review_note: note,
      })
      .eq("id", post.id)
      .is("manual_tier", null)
      .select(
        "id,x_post_id,manual_tier,manual_category,manual_reviewed_at,content_category",
      );
    if (updateError) throw updateError;
    if (!updated || updated.length === 0) {
      return errorMessage(409, "Post has already been reviewed");
    }

    return NextResponse.json(
      {
        success: true,
        post: updated[0],
        verdict,
        session_increment: {
          correct: verdict === "correct" ? 1 : 0,
          false_positive: verdict === "false_positive" ? 1 : 0,
        },
      },
      { headers: headers() },
    );
  } catch {
    return errorMessage(500, "Failed to save content filter review");
  }
}
