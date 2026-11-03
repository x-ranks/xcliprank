import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "../../../lib/supabase-admin";

export const runtime = "nodejs";

/*
 * =========================
 * 認証
 * =========================
 */
function authorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    return false;
  }

  const auth =
    req.headers.get("authorization");

  const querySecret =
    req.nextUrl.searchParams.get("secret");

  return (
    auth === `Bearer ${secret}` ||
    querySecret === secret
  );
}

/*
 * =========================
 * 型
 * =========================
 */
type PostRow = {
  x_post_id: string;
  author_id: string | null;

  possibly_sensitive:
    boolean | null;

  adult_score:
    number | null;

  creator_score:
    number | null;

  review_required:
    boolean | null;
};

type AuthorRow = {
  x_author_id: string;

  adult_score:
    number | null;

  creator_score:
    number | null;

  sensitive_ratio:
    number | null;

  cumulative_posts:
    number | null;

  cumulative_video_posts:
    number | null;

  video_ratio:
    number | null;

  review_required:
    boolean | null;
};

type EffectiveUpdate = {
  x_post_id: string;

  effective_adult_score:
    number;

  adult_tier:
    string;

  reason:
    string;
};

/*
 * =========================
 * Tier判定
 * =========================
 */
function calculateTier(
  post: PostRow,
  author: AuthorRow | undefined
) {
  const sensitive =
    post.possibly_sensitive === true;

  const postAdultScore =
    Number(
      post.adult_score ?? 0
    );

  const postCreatorScore =
    Number(
      post.creator_score ?? 0
    );

  const authorAdultScore =
    Number(
      author?.adult_score ?? 0
    );

  const authorCreatorScore =
    Number(
      author?.creator_score ?? 0
    );

  const sensitiveRatio =
    Number(
      author?.sensitive_ratio ?? 0
    );

  const cumulativePosts =
    Number(
      author?.cumulative_posts ?? 0
    );

  const cumulativeVideoPosts =
    Number(
      author?.cumulative_video_posts ?? 0
    );

  const videoRatio =
    Number(
      author?.video_ratio ?? 0
    );

  /*
   * =========================
   * X
   * Safety除外
   * =========================
   */
  if (
    post.review_required ||
    author?.review_required
  ) {
    return {
      score: 0,
      tier: "X",
      reason: "review_required"
    };
  }

  /*
   * =========================
   * S
   * =========================
   */
  if (
    sensitive &&
    authorCreatorScore >= 0.7 &&
    sensitiveRatio >= 0.8 &&
    cumulativePosts >= 5 &&
    videoRatio >= 0.8
  ) {
    return {
      score: 0.95,
      tier: "S",
      reason:
        "sensitive_strong_creator_author"
    };
  }

  /*
   * 投稿単体＋投稿者
   * Creatorシグナル
   */
  if (
    sensitive &&
    postCreatorScore >= 0.5 &&
    authorCreatorScore >= 0.5
  ) {
    return {
      score: 0.92,
      tier: "S",
      reason:
        "sensitive_creator_post_and_author"
    };
  }

  /*
   * =========================
   * A+
   * =========================
   */
  if (
    sensitive &&
    authorCreatorScore >= 0.6 &&
    sensitiveRatio >= 0.7 &&
    cumulativePosts >= 3
  ) {
    return {
      score: 0.86,
      tier: "A+",
      reason:
        "sensitive_high_creator_author"
    };
  }

  /*
   * =========================
   * A
   * =========================
   */
  if (
    sensitive &&
    authorCreatorScore >= 0.5 &&
    cumulativePosts >= 2
  ) {
    return {
      score: 0.8,
      tier: "A",
      reason:
        "sensitive_creator_author"
    };
  }

  /*
   * 投稿単体Creator
   */
  if (
    sensitive &&
    postCreatorScore >= 0.25
  ) {
    return {
      score: 0.78,
      tier: "A",
      reason:
        "sensitive_creator_post"
    };
  }

  /*
   * =========================
   * B+
   * =========================
   */
  if (
    sensitive &&
    authorAdultScore >= 0.55 &&
    cumulativePosts >= 5 &&
    cumulativeVideoPosts >= 4 &&
    videoRatio >= 0.8
  ) {
    return {
      score: 0.72,
      tier: "B+",
      reason:
        "sensitive_adult_author"
    };
  }

  /*
   * =========================
   * B
   * =========================
   */
  if (
    sensitive &&
    sensitiveRatio >= 0.8 &&
    cumulativePosts >= 3
  ) {
    return {
      score: 0.67,
      tier: "B",
      reason:
        "sensitive_high_sensitive_ratio"
    };
  }

  /*
   * 投稿単体に強めの
   * 成人向けシグナル
   */
  if (
    sensitive &&
    postAdultScore > 0.42
  ) {
    return {
      score: 0.63,
      tier: "B",
      reason:
        "sensitive_extra_adult_signal"
    };
  }

  /*
   * =========================
   * C
   * =========================
   */
  if (sensitive) {
    return {
      score: 0.55,
      tier: "C",
      reason:
        "sensitive_only"
    };
  }

  /*
   * =========================
   * D+
   * =========================
   */
  if (
    postAdultScore >= 0.7
  ) {
    return {
      score: 0.5,
      tier: "D+",
      reason:
        "strong_adult_signal_without_sensitive"
    };
  }

  /*
   * =========================
   * D
   * 投稿者Creator
   * =========================
   */
  if (
    authorCreatorScore >= 0.6 &&
    cumulativePosts >= 5
  ) {
    return {
      score: 0.42,
      tier: "D",
      reason:
        "creator_author_without_sensitive"
    };
  }

  /*
   * 投稿単体Creator
   */
  if (
    postCreatorScore >= 0.5
  ) {
    return {
      score: 0.35,
      tier: "D",
      reason:
        "creator_post_without_sensitive"
    };
  }

  /*
   * =========================
   * NONE
   * =========================
   */
  return {
    score: 0,
    tier: "NONE",
    reason:
      "no_adult_signal"
  };
}

/*
 * =========================
 * GET
 * =========================
 */
export async function GET(
  req: NextRequest
) {
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
    const supabase =
      supabaseAdmin();

    /*
     * =========================
     * 1. authors全件取得
     * =========================
     */
    const {
      data: authorData,
      error: authorError
    } = await supabase
      .from("authors")
      .select(`
        x_author_id,
        adult_score,
        creator_score,
        sensitive_ratio,
        cumulative_posts,
        cumulative_video_posts,
        video_ratio,
        review_required
      `);

    if (authorError) {
      throw authorError;
    }

    /*
     * ここを修正
     */
    const authors: AuthorRow[] =
      (authorData ?? []) as AuthorRow[];

    const authorMap =
      new Map<string, AuthorRow>();

    for (
      const author of authors
    ) {
      authorMap.set(
        author.x_author_id,
        author
      );
    }

    /*
     * =========================
     * 2. posts全件取得
     * =========================
     */
    const PAGE_SIZE = 1000;

    let from = 0;

    const allPosts:
      PostRow[] = [];

    while (true) {
      const to =
        from +
        PAGE_SIZE -
        1;

      const {
        data,
        error
      } = await supabase
        .from("posts")
        .select(`
          x_post_id,
          author_id,
          possibly_sensitive,
          adult_score,
          creator_score,
          review_required
        `)
        .order(
          "created_at",
          {
            ascending: false
          }
        )
        .range(
          from,
          to
        );

      if (error) {
        throw error;
      }

      /*
       * ここも同様に
       * 改行問題が起きない形
       */
      const page: PostRow[] =
        (data ?? []) as PostRow[];

      allPosts.push(
        ...page
      );

      console.log(
        `TIER FETCH: ${allPosts.length}`
      );

      if (
        page.length <
        PAGE_SIZE
      ) {
        break;
      }

      from += PAGE_SIZE;
    }

    /*
     * =========================
     * 3. Tier判定
     * =========================
     */
    const updates:
      EffectiveUpdate[] =
      allPosts.map(
        (post) => {
          const author =
            post.author_id
              ? authorMap.get(
                  post.author_id
                )
              : undefined;

          const result =
            calculateTier(
              post,
              author
            );

          return {
            x_post_id:
              post.x_post_id,

            effective_adult_score:
              Number(
                result.score.toFixed(
                  4
                )
              ),

            adult_tier:
              result.tier,

            reason:
              result.reason
          };
        }
      );

    /*
     * =========================
     * 4. posts更新
     * =========================
     */
    const BATCH_SIZE = 20;

    let updatedPosts = 0;

    for (
      let i = 0;
      i < updates.length;
      i += BATCH_SIZE
    ) {
      const batch =
        updates.slice(
          i,
          i + BATCH_SIZE
        );

      const results =
        await Promise.all(
          batch.map(
            async (
              post
            ) => {
              const {
                error
              } = await supabase
                .from("posts")
                .update({
                  effective_adult_score:
                    post
                      .effective_adult_score,

                  adult_tier:
                    post
                      .adult_tier
                })
                .eq(
                  "x_post_id",
                  post
                    .x_post_id
                );

              if (error) {
                throw error;
              }

              return true;
            }
          )
        );

      updatedPosts +=
        results.length;

      console.log(
        `TIER UPDATE: ${updatedPosts}/${updates.length}`
      );
    }

    /*
     * =========================
     * 5. Tier集計
     * =========================
     */
    const tierCounts:
      Record<
        string,
        number
      > = {};

    const reasonCounts:
      Record<
        string,
        number
      > = {};

    for (
      const post of updates
    ) {
      tierCounts[
        post.adult_tier
      ] =
        (
          tierCounts[
            post.adult_tier
          ] ?? 0
        ) + 1;

      reasonCounts[
        post.reason
      ] =
        (
          reasonCounts[
            post.reason
          ] ?? 0
        ) + 1;
    }

    /*
     * =========================
     * 6. 集計指標
     * =========================
     */
    const rankingCandidates =
      updates.filter(
        (post) =>
          post
            .effective_adult_score >=
          0.55
      ).length;

    const creatorPriorityCandidates =
      updates.filter(
        (post) =>
          post.adult_tier ===
            "S" ||
          post.adult_tier ===
            "A+" ||
          post.adult_tier ===
            "A"
      ).length;

    const highPriorityCandidates =
      updates.filter(
        (post) =>
          post
            .effective_adult_score >=
          0.8
      ).length;

    const mediumPriorityCandidates =
      updates.filter(
        (post) =>
          post
            .effective_adult_score >=
            0.65 &&
          post
            .effective_adult_score <
            0.8
      ).length;

    const averageScore =
      updates.length > 0
        ? Number(
            (
              updates.reduce(
                (
                  total,
                  post
                ) =>
                  total +
                  post
                    .effective_adult_score,
                0
              ) /
              updates.length
            ).toFixed(4)
          )
        : 0;

    /*
     * =========================
     * 7. 完了
     * =========================
     */
    return NextResponse.json({
      ok: true,

      processedPosts:
        allPosts.length,

      updatedPosts,

      rankingCandidates,

      creatorPriorityCandidates,

      highPriorityCandidates,

      mediumPriorityCandidates,

      candidateRatio:
        allPosts.length > 0
          ? Number(
              (
                rankingCandidates /
                allPosts.length
              ).toFixed(4)
            )
          : 0,

      averageEffectiveAdultScore:
        averageScore,

      tierCounts,

      reasonCounts,

      message:
        "effective_adult_score と adult_tier を全投稿へ保存しました。"
    });
  } catch (error) {
    console.error(
      "TIER RECOUNT ERROR:",
      error
    );

    return NextResponse.json(
      {
        ok: false,

        error:
          error instanceof Error
            ? error.message
            : JSON.stringify(
                error
              )
      },
      {
        status: 500
      }
    );
  }
}