import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "../../../lib/supabase-admin";

export const runtime = "nodejs";

/*
 * 認証
 */
function authorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    return false;
  }

  const auth = req.headers.get("authorization");
  const querySecret = req.nextUrl.searchParams.get("secret");

  return (
    auth === `Bearer ${secret}` ||
    querySecret === secret
  );
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json(
      {
        error: "Unauthorized"
      },
      {
        status: 401
      }
    );
  }

  try {
    const supabase = supabaseAdmin();

    /*
     * =========================
     * 候補投稿者を取得
     * =========================
     *
     * adult_score >= 0.55
     * review_required = false
     */
    const {
      data,
      error
    } = await supabase
      .from("authors")
      .select(`
        x_author_id,
        username,
        name,
        cumulative_posts,
        cumulative_video_posts,
        adult_score,
        video_ratio,
        avg_views,
        priority,
        review_required,
        last_checked_at
      `)
      .gte("adult_score", 0.55)
      .eq("review_required", false)
      .not("username", "is", null)
      .order(
        "adult_score",
        {
          ascending: false
        }
      )
      .order(
        "priority",
        {
          ascending: false
        }
      )
      .limit(100);

    if (error) {
      throw error;
    }

    const authors = data ?? [];

    /*
     * =========================
     * 優先追跡
     * =========================
     *
     * 2投稿以上確認済み
     */
    const priorityAuthors =
      authors
        .filter(
          (author) =>
            author.cumulative_posts >= 2
        )
        .map((author) => ({
          ...author,

          group:
            "priority",

          search_query:
            `from:${author.username} has:videos -is:retweet`
        }));

    /*
     * =========================
     * 探索候補
     * =========================
     *
     * まだ1投稿しか
     * 確認できていない投稿者
     */
    const discoveryAuthors =
      authors
        .filter(
          (author) =>
            author.cumulative_posts === 1
        )
        .map((author) => ({
          ...author,

          group:
            "discovery",

          search_query:
            `from:${author.username} has:videos -is:retweet`
        }));

    /*
     * =========================
     * 結果
     * =========================
     */
    return NextResponse.json({
      ok: true,

      totalCandidates:
        authors.length,

      priorityCount:
        priorityAuthors.length,

      discoveryCount:
        discoveryAuthors.length,

      priorityAuthors,

      discoveryAuthors
    });
  } catch (error) {
    console.error(
      "ADULT AUTHORS ERROR:",
      error
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : JSON.stringify(error)
      },
      {
        status: 500
      }
    );
  }
}