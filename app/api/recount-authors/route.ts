import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "../../../lib/supabase-admin";
import {
  calculateAdultScore,
  calculateCreatorScore,
  requiresSafetyReview
} from "../../../lib/adult-score";

export const runtime = "nodejs";

/*
 * =========================
 * 認証
 * =========================
 */
function authorized(req: NextRequest) {
  const secret =
    process.env.CRON_SECRET;

  if (!secret) {
    return false;
  }

  const auth =
    req.headers.get(
      "authorization"
    );

  const querySecret =
    req.nextUrl
      .searchParams
      .get("secret");

  return (
    auth ===
      `Bearer ${secret}` ||
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

  author_id:
    string | null;

  author_username:
    string | null;

  author_name:
    string | null;

  text:
    string | null;

  possibly_sensitive:
    boolean | null;

  media_key:
    string | null;

  views:
    number | null;

  likes:
    number | null;

  reposts:
    number | null;
};

type OldAuthorRow = {
  x_author_id: string;

  username:
    string | null;

  name:
    string | null;

  cumulative_posts:
    number | null;

  cumulative_video_posts:
    number | null;

  cumulative_adult_score:
    number | null;

  cumulative_views:
    number | null;

  cumulative_likes:
    number | null;

  cumulative_reposts:
    number | null;

  sensitive_posts:
    number | null;

  creator_score:
    number | null;

  review_required:
    boolean | null;
};

/*
 * =========================
 * 投稿者Creator Score
 * =========================
 *
 * 投稿単体のcreator_scoreとは別。
 *
 * 投稿者の
 *
 * ・センシティブ投稿率
 * ・動画投稿率
 * ・継続投稿数
 * ・投稿本文のcreatorシグナル
 *
 * を使って評価する。
 */
function calculateAuthorCreatorScore(
  sensitiveRatio: number,
  videoRatio: number,
  cumulativePosts: number,
  averagePostCreatorScore: number
) {
  let score = 0;

  /*
   * =========================
   * 1. Sensitive率
   * 最大 0.40
   * =========================
   */
  score +=
    Math.min(
      sensitiveRatio,
      1
    ) * 0.4;

  /*
   * =========================
   * 2. 動画投稿率
   * 最大 0.20
   * =========================
   */
  score +=
    Math.min(
      videoRatio,
      1
    ) * 0.2;

  /*
   * =========================
   * 3. 継続投稿実績
   * 最大 0.20
   * =========================
   */
  if (
    cumulativePosts >= 20
  ) {
    score += 0.2;
  } else if (
    cumulativePosts >= 10
  ) {
    score += 0.16;
  } else if (
    cumulativePosts >= 5
  ) {
    score += 0.12;
  } else if (
    cumulativePosts >= 3
  ) {
    score += 0.08;
  } else if (
    cumulativePosts >= 2
  ) {
    score += 0.04;
  }

  /*
   * =========================
   * 4. 本文Creatorシグナル
   * 最大 0.20
   * =========================
   */
  score +=
    Math.min(
      averagePostCreatorScore,
      1
    ) * 0.2;

  return Math.min(
    Number(
      score.toFixed(4)
    ),
    1
  );
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
        error:
          "Unauthorized"
      },
      {
        status: 401
      }
    );
  }

  try {
    const supabase =
      supabaseAdmin();

    const now =
      new Date().toISOString();

    /*
     * =========================
     * 1. 未集計投稿だけ取得
     * =========================
     */
    const {
      data,
      error
    } =
      await supabase
        .from("posts")
        .select(`
          x_post_id,
          author_id,
          author_username,
          author_name,
          text,
          possibly_sensitive,
          media_key,
          views,
          likes,
          reposts
        `)
        .eq(
          "author_stats_counted",
          false
        )
        .not(
          "author_id",
          "is",
          null
        )
        .limit(1000);

    if (error) {
      throw error;
    }

    const posts =
      (
        data ?? []
      ) as PostRow[];

    /*
     * 未処理投稿なし
     */
    if (
      posts.length === 0
    ) {
      return NextResponse.json({
        ok: true,

        countedPosts: 0,

        updatedAuthors: 0,

        message:
          "集計対象の未処理投稿はありません。"
      });
    }

    /*
     * =========================
     * 2. 投稿者ごとの差分
     * =========================
     */
    const deltaMap =
      new Map<
        string,
        {
          x_author_id: string;

          username:
            string | null;

          name:
            string | null;

          posts: number;

          video_posts:
            number;

          sensitive_posts:
            number;

          adult_score_sum:
            number;

          creator_score_sum:
            number;

          views: number;

          likes: number;

          reposts: number;

          review_required:
            boolean;
        }
      >();

    for (
      const post of posts
    ) {
      if (!post.author_id) {
        continue;
      }

      const text =
        post.text ?? "";

      const adultScore =
        calculateAdultScore(
          text,
          post
            .possibly_sensitive ??
            false
        );

      const postCreatorScore =
        calculateCreatorScore(
          text
        );

      const review =
        requiresSafetyReview(
          text
        );

      const isSensitive =
        post
          .possibly_sensitive ===
        true;

      const existing =
        deltaMap.get(
          post.author_id
        );

      if (existing) {
        existing.posts += 1;

        existing.video_posts +=
          post.media_key
            ? 1
            : 0;

        existing.sensitive_posts +=
          isSensitive
            ? 1
            : 0;

        existing.adult_score_sum +=
          adultScore;

        existing.creator_score_sum +=
          postCreatorScore;

        existing.views +=
          post.views ?? 0;

        existing.likes +=
          post.likes ?? 0;

        existing.reposts +=
          post.reposts ?? 0;

        existing.review_required =
          existing.review_required ||
          review;
      } else {
        deltaMap.set(
          post.author_id,
          {
            x_author_id:
              post.author_id,

            username:
              post.author_username,

            name:
              post.author_name,

            posts: 1,

            video_posts:
              post.media_key
                ? 1
                : 0,

            sensitive_posts:
              isSensitive
                ? 1
                : 0,

            adult_score_sum:
              adultScore,

            creator_score_sum:
              postCreatorScore,

            views:
              post.views ?? 0,

            likes:
              post.likes ?? 0,

            reposts:
              post.reposts ?? 0,

            review_required:
              review
          }
        );
      }
    }

    const authorIds =
      Array.from(
        deltaMap.keys()
      );

    /*
     * =========================
     * 3. 現在のauthors取得
     * =========================
     */
    const {
      data:
        oldAuthorData,
      error:
        oldError
    } =
      await supabase
        .from("authors")
        .select(`
          x_author_id,
          username,
          name,
          cumulative_posts,
          cumulative_video_posts,
          cumulative_adult_score,
          cumulative_views,
          cumulative_likes,
          cumulative_reposts,
          sensitive_posts,
          creator_score,
          review_required
        `)
        .in(
          "x_author_id",
          authorIds
        );

    if (oldError) {
      throw oldError;
    }

    const oldAuthors =
      (
        oldAuthorData ??
        []
      ) as OldAuthorRow[];

    const oldMap =
      new Map<
        string,
        OldAuthorRow
      >();

    for (
      const author of
      oldAuthors
    ) {
      oldMap.set(
        author.x_author_id,
        author
      );
    }

    /*
     * =========================
     * 4. 累積値を作成
     * =========================
     */
    const authors =
      Array.from(
        deltaMap.values()
      ).map(
        (delta) => {
          const old =
            oldMap.get(
              delta.x_author_id
            );

          const oldPosts =
            Number(
              old
                ?.cumulative_posts ??
                0
            );

          const cumulativePosts =
            oldPosts +
            delta.posts;

          const cumulativeVideoPosts =
            Number(
              old
                ?.cumulative_video_posts ??
                0
            ) +
            delta.video_posts;

          const cumulativeAdultScore =
            Number(
              old
                ?.cumulative_adult_score ??
                0
            ) +
            delta.adult_score_sum;

          const cumulativeViews =
            Number(
              old
                ?.cumulative_views ??
                0
            ) +
            delta.views;

          const cumulativeLikes =
            Number(
              old
                ?.cumulative_likes ??
                0
            ) +
            delta.likes;

          const cumulativeReposts =
            Number(
              old
                ?.cumulative_reposts ??
                0
            ) +
            delta.reposts;

          /*
           * Sensitive累積
           */
          const cumulativeSensitivePosts =
            Number(
              old
                ?.sensitive_posts ??
                0
            ) +
            delta.sensitive_posts;

          /*
           * =========================
           * 各種比率
           * =========================
           */
          const videoRatio =
            cumulativePosts > 0
              ? cumulativeVideoPosts /
                cumulativePosts
              : 0;

          const sensitiveRatio =
            cumulativePosts > 0
              ? cumulativeSensitivePosts /
                cumulativePosts
              : 0;

          const adultScore =
            cumulativePosts > 0
              ? cumulativeAdultScore /
                cumulativePosts
              : 0;

          /*
           * =========================
           * Creator Score累積
           * =========================
           *
           * authorsには投稿単体の
           * creator_score_sum列を
           * 持っていないため、
           *
           * 既存creator_scoreから
           * 過去分の推定合計を復元して
           * 新規分を追加する。
           */
          const oldCreatorAverage =
            Number(
              old
                ?.creator_score ??
                0
            );

          const estimatedOldCreatorSum =
            oldCreatorAverage *
            oldPosts;

          const cumulativeCreatorSignal =
            estimatedOldCreatorSum +
            delta.creator_score_sum;

          const averagePostCreatorScore =
            cumulativePosts > 0
              ? cumulativeCreatorSignal /
                cumulativePosts
              : 0;

          /*
           * 投稿者Creator Score
           */
          const authorCreatorScore =
            calculateAuthorCreatorScore(
              sensitiveRatio,
              videoRatio,
              cumulativePosts,
              averagePostCreatorScore
            );

          /*
           * =========================
           * 平均Engagement
           * =========================
           */
          const avgViews =
            cumulativePosts > 0
              ? Math.round(
                  cumulativeViews /
                    cumulativePosts
                )
              : 0;

          const avgLikes =
            cumulativePosts > 0
              ? Math.round(
                  cumulativeLikes /
                    cumulativePosts
                )
              : 0;

          const avgReposts =
            cumulativePosts > 0
              ? Math.round(
                  cumulativeReposts /
                    cumulativePosts
                )
              : 0;

          /*
           * =========================
           * Priority
           * =========================
           *
           * 動画率 最大3
           * 成人向け 最大5
           * Creator 最大2
           * View 最大3
           *
           * 最大13
           */
          const priority =
            Math.round(
              videoRatio * 3
            ) +
            Math.round(
              adultScore * 5
            ) +
            Math.round(
              authorCreatorScore *
                2
            ) +
            (
              avgViews >=
              100000
                ? 3
                : avgViews >=
                    10000
                ? 2
                : avgViews >=
                    1000
                ? 1
                : 0
            );

          return {
            x_author_id:
              delta.x_author_id,

            username:
              delta.username ??
              old?.username ??
              null,

            name:
              delta.name ??
              old?.name ??
              null,

            /*
             * =====================
             * 通常表示
             * =====================
             */
            total_posts:
              cumulativePosts,

            video_posts:
              cumulativeVideoPosts,

            video_ratio:
              Number(
                videoRatio.toFixed(
                  4
                )
              ),

            adult_score:
              Number(
                adultScore.toFixed(
                  4
                )
              ),

            creator_score:
              authorCreatorScore,

            sensitive_posts:
              cumulativeSensitivePosts,

            sensitive_ratio:
              Number(
                sensitiveRatio.toFixed(
                  4
                )
              ),

            avg_views:
              avgViews,

            avg_likes:
              avgLikes,

            avg_reposts:
              avgReposts,

            priority,

            review_required:
              Boolean(
                old
                  ?.review_required
              ) ||
              delta.review_required,

            /*
             * =====================
             * 累積値
             * =====================
             */
            cumulative_posts:
              cumulativePosts,

            cumulative_video_posts:
              cumulativeVideoPosts,

            cumulative_adult_score:
              Number(
                cumulativeAdultScore.toFixed(
                  4
                )
              ),

            cumulative_views:
              cumulativeViews,

            cumulative_likes:
              cumulativeLikes,

            cumulative_reposts:
              cumulativeReposts,

            last_seen_at:
              now,

            last_checked_at:
              now
          };
        }
      );

    /*
     * =========================
     * 5. authors更新
     * =========================
     */
    const {
      error:
        authorError
    } =
      await supabase
        .from("authors")
        .upsert(
          authors,
          {
            onConflict:
              "x_author_id"
          }
        );

    if (authorError) {
      throw authorError;
    }

    /*
     * =========================
     * 6. 成功投稿だけcounted
     * =========================
     */
    const postIds =
      posts.map(
        (post) =>
          post.x_post_id
      );

    const {
      error:
        countedError
    } =
      await supabase
        .from("posts")
        .update({
          author_stats_counted:
            true
        })
        .in(
          "x_post_id",
          postIds
        );

    if (countedError) {
      throw countedError;
    }

    /*
     * =========================
     * 7. 結果
     * =========================
     */
    return NextResponse.json({
      ok: true,

      countedPosts:
        posts.length,

      updatedAuthors:
        authors.length,

      adultAuthors:
        authors.filter(
          (author) =>
            author.adult_score >=
            0.55
        ).length,

      creatorAuthors:
        authors.filter(
          (author) =>
            author.creator_score >=
            0.5
        ).length,

      strongCreatorAuthors:
        authors.filter(
          (author) =>
            author.creator_score >=
            0.7
        ).length,

      highSensitiveAuthors:
        authors.filter(
          (author) =>
            author.sensitive_ratio >=
            0.7
        ).length,

      reviewRequired:
        authors.filter(
          (author) =>
            author.review_required
        ).length
    });
  } catch (error) {
    console.error(
      "RECOUNT AUTHORS ERROR:",
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