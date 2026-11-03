import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "../../../lib/supabase-admin";

type ReviewPost = {
  id: number;
  x_post_id: string;
  author_id: string | null;
  author_username: string | null;
  author_name: string | null;
  text: string | null;
  created_at: string | null;
  x_url: string | null;
  preview_image_url: string | null;
  video_url: string | null;

  views: number | null;
  likes: number | null;
  reposts: number | null;
  replies: number | null;

  adult_score: number | null;
  creator_score: number | null;
  effective_adult_score: number | null;
  adult_tier: string | null;

  manual_tier: string | null;
  manual_category: string | null;
  manual_reviewed_at: string | null;
  manual_review_note: string | null;
};

const SELECT_FIELDS = `
  id,
  x_post_id,
  author_id,
  author_username,
  author_name,
  text,
  created_at,
  x_url,
  preview_image_url,
  video_url,
  views,
  likes,
  reposts,
  replies,
  adult_score,
  creator_score,
  effective_adult_score,
  adult_tier,
  manual_tier,
  manual_category,
  manual_reviewed_at,
  manual_review_note
`;

const REVIEWABLE_AUTO_TIERS = [
  "S",
  "A+",
  "A",
  "B+",
  "B",
  "C",
  "D+",
  "D",
] as const;

function isReviewableAutoTier(tier: string | null) {
  return tier !== null &&
    (REVIEWABLE_AUTO_TIERS as readonly string[]).includes(tier);
}

async function getTierPosts(
  tiers: string[],
  limit: number
): Promise<ReviewPost[]> {
  const { data, error } = await supabaseAdmin()
    .from("posts")
    .select(SELECT_FIELDS)
    .is("manual_tier", null)
    .eq("collection_source", "curated")
    .eq("is_visible", true)
    .eq("review_required", false)
    .not("video_url", "is", null)
    .in("adult_tier", tiers)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw error;
  }

  return (data ?? []) as ReviewPost[];
}

async function getUncensoredCandidates(): Promise<ReviewPost[]> {
  const baseQuery = () =>
    supabaseAdmin()
      .from("posts")
      .select(SELECT_FIELDS)
      .is("manual_tier", null)
      .eq("collection_source", "curated")
      .eq("is_visible", true)
      .eq("review_required", false)
      .eq("content_category", "PASS")
      .in("adult_tier", [...REVIEWABLE_AUTO_TIERS])
      .not("video_url", "is", null);

  const [
    explicitResult,
    relatedResult,
  ] = await Promise.all([
    baseQuery()
      .or(
        [
          "text.ilike.%無修正%",
          "text.ilike.%無碼%",
          "text.ilike.%uncensored%",
          "text.ilike.%モザイクなし%",
          "text.ilike.%モザイク無し%",
          "text.ilike.%モザイク無%",
          "text.ilike.%ノーモザイク%",
        ].join(",")
      )
      .order("created_at", { ascending: false })
      .limit(10),

    baseQuery()
      .eq("possibly_sensitive", true)
      .or(
        [
          "text.ilike.%個人撮影%",
          "text.ilike.%個撮%",
          "text.ilike.%ハメ撮り%",
          "text.ilike.%素人%",
          "text.ilike.%流出%",
          "text.ilike.%流失%",
          "text.ilike.%FC2%",
        ].join(",")
      )
      .order("created_at", { ascending: false })
      .limit(60),
  ]);

  if (explicitResult.error) {
    throw explicitResult.error;
  }

  if (relatedResult.error) {
    throw relatedResult.error;
  }

  const candidates = [
    ...((explicitResult.data ?? []) as ReviewPost[]),
    ...((relatedResult.data ?? []) as ReviewPost[]),
  ];

  return Array.from(
    new Map(
      candidates.map((post) => [post.id, post])
    ).values()
  );
}

export async function GET() {
  try {
    const [
      uncensoredCandidates,
      tierS,
      tierA,
      tierB,
      tierC,
      tierD,
    ] = await Promise.all([
      getUncensoredCandidates(),
      getTierPosts(["S", "A+"], 20),
      getTierPosts(["A"], 20),
      getTierPosts(["B", "B+"], 20),
      getTierPosts(["C"], 15),
      getTierPosts(["D", "D+"], 15),
    ]);

    const combinedPosts = [
      ...uncensoredCandidates,
      ...tierS,
      ...tierA,
      ...tierB,
      ...tierC,
      ...tierD,
    ];

    const posts = Array.from(
      new Map(
        combinedPosts.map((post) => [post.id, post])
      ).values()
    )
      .filter((post) => isReviewableAutoTier(post.adult_tier))
      .slice(0, 100);

    return NextResponse.json({
      success: true,
      count: posts.length,
      focus: "uncensored_candidates",
      focusedCount: Math.min(
        uncensoredCandidates.length,
        posts.length
      ),
      distribution: {
        high: tierS.length,
        a: tierA.length,
        b: tierB.length,
        c: tierC.length,
        d: tierD.length,
      },
      posts,
    });
  } catch (error) {
    console.error("Review GET error:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unknown error",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const {
      postId,
      manualTier,
      manualCategory = null,
      manualReviewNote = null,
    } = body;

    const allowedTiers = ["S", "A", "B", "C", "D", "X"];

    if (!postId) {
      return NextResponse.json(
        {
          success: false,
          error: "postId is required",
        },
        { status: 400 }
      );
    }

    if (!allowedTiers.includes(manualTier)) {
      return NextResponse.json(
        {
          success: false,
          error: "manualTier must be S, A, B, C, D or X",
        },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin()
      .from("posts")
      .update({
        manual_tier: manualTier,
        manual_category: manualCategory,
        manual_review_note: manualReviewNote,
        manual_reviewed_at: new Date().toISOString(),
      })
      .eq("id", postId)
      .select(
        `
        id,
        x_post_id,
        adult_tier,
        manual_tier,
        manual_category,
        manual_reviewed_at
        `
      )
      .single();

    if (error) {
      throw error;
    }

    return NextResponse.json({
      success: true,
      post: data,
    });
  } catch (error) {
    console.error("Review POST error:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unknown error",
      },
      { status: 500 }
    );
  }
}
