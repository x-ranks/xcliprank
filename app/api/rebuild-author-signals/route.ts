import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "../../../lib/supabase-admin";
import { calculateCreatorScore } from "../../../lib/adult-score";

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

  author_id:
    string | null;

  text:
    string | null;

  possibly_sensitive:
    boolean | null;

  media_key:
    string | null;
};

type AuthorSignal = {
  x_author_id: string;

  total_posts: number;

  video_posts: number;

  sensitive_posts: number;

  creator_score_sum: number;
};

/*
 * =========================
 * 投稿者Creator Score
 * =========================
 *
 * 投稿者について、
 *
 * ・センシティブ投稿率
 * ・動画投稿率
 * ・投稿数
 * ・本文Creatorシグナル
 *
 * を組み合わせる。
 */
function calculateAuthorCreatorScore(
  sensitiveRatio: number,
  videoRatio: number,
  totalPosts: number,
  averagePostCreatorScore: number
) {
  let score = 0;

  /*
   * =========================
   * Sensitive率
   *
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
   * 動画率
   *
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
   * 継続投稿実績
   *
   * 最大 0.20
   * =========================
   */
  if (totalPosts >= 20) {
    score += 0.2;
  } else if (
    totalPosts >= 10
  ) {
    score += 0.16;
  } else if (
    totalPosts >= 5
  ) {
    score += 0.12;
  } else if (
    totalPosts >= 3
  ) {
    score += 0.08;
  } else if (
    totalPosts >= 2
  ) {
    score += 0.04;
  }

  /*
   * =========================
   * 本文Creatorシグナル
   *
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
     * 1. 全投稿取得
     * =========================
     *
     * Supabaseの1000件制限を
     * 回避するためページング。
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
          text,
          possibly_sensitive,
          media_key
        `)
        .not(
          "author_id",
          "is",
          null
        )
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

      const page =
        (data ?? []) as PostRow[];

      allPosts.push(
        ...page
      );

      console.log(
        `AUTHOR SIGNAL FETCH: ${allPosts.length}`
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
     * 2. 投稿者単位に集計
     * =========================
     */
    const authorMap =
      new Map<
        string,
        AuthorSignal
      >();

    for (
      const post of allPosts
    ) {
      if (!post.author_id) {
        continue;
      }

      const creatorScore =
        calculateCreatorScore(
          post.text ?? ""
        );

      const isSensitive =
        post
          .possibly_sensitive ===
        true;

      const existing =
        authorMap.get(
          post.author_id
        );

      if (existing) {
        existing.total_posts +=
          1;

        existing.video_posts +=
          post.media_key
            ? 1
            : 0;

        existing.sensitive_posts +=
          isSensitive
            ? 1
            : 0;

        existing.creator_score_sum +=
          creatorScore;
      } else {
        authorMap.set(
          post.author_id,
          {
            x_author_id:
              post.author_id,

            total_posts: 1,

            video_posts:
              post.media_key
                ? 1
                : 0,

            sensitive_posts:
              isSensitive
                ? 1
                : 0,

            creator_score_sum:
              creatorScore
          }
        );
      }
    }

    /*
     * =========================
     * 3. 投稿者シグナル計算
     * =========================
     */
    const updates =
      Array.from(
        authorMap.values()
      ).map(
        (author) => {
          const sensitiveRatio =
            author.total_posts > 0
              ? author.sensitive_posts /
                author.total_posts
              : 0;

          const videoRatio =
            author.total_posts > 0
              ? author.video_posts /
                author.total_posts
              : 0;

          const averagePostCreatorScore =
            author.total_posts > 0
              ? author.creator_score_sum /
                author.total_posts
              : 0;

          const creatorScore =
            calculateAuthorCreatorScore(
              sensitiveRatio,
              videoRatio,
              author.total_posts,
              averagePostCreatorScore
            );

          return {
            x_author_id:
              author.x_author_id,

            sensitive_posts:
              author.sensitive_posts,

            sensitive_ratio:
              Number(
                sensitiveRatio.toFixed(
                  4
                )
              ),

            creator_score:
              creatorScore
          };
        }
      );

    /*
     * =========================
     * 4. authors更新
     * =========================
     *
     * updateを使うことで、
     *
     * cumulative_posts
     * adult_score
     * views
     * priority
     *
     * など既存値を変更しない。
     */
    const BATCH_SIZE = 20;

    let updatedAuthors = 0;

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
              author
            ) => {
              const {
                error
              } = await supabase
                .from("authors")
                .update({
                  sensitive_posts:
                    author
                      .sensitive_posts,

                  sensitive_ratio:
                    author
                      .sensitive_ratio,

                  creator_score:
                    author
                      .creator_score
                })
                .eq(
                  "x_author_id",
                  author
                    .x_author_id
                );

              if (error) {
                throw error;
              }

              return true;
            }
          )
        );

      updatedAuthors +=
        results.length;

      console.log(
        `AUTHOR SIGNAL UPDATE: ${updatedAuthors}/${updates.length}`
      );
    }

    /*
     * =========================
     * 5. 分布確認
     * =========================
     */

    const creator05 =
      updates.filter(
        (author) =>
          author.creator_score >=
          0.5
      ).length;

    const creator06 =
      updates.filter(
        (author) =>
          author.creator_score >=
          0.6
      ).length;

    const creator07 =
      updates.filter(
        (author) =>
          author.creator_score >=
          0.7
      ).length;

    const sensitive05 =
      updates.filter(
        (author) =>
          author.sensitive_ratio >=
          0.5
      ).length;

    const sensitive07 =
      updates.filter(
        (author) =>
          author.sensitive_ratio >=
          0.7
      ).length;

    const sensitive09 =
      updates.filter(
        (author) =>
          author.sensitive_ratio >=
          0.9
      ).length;

    const averageCreatorScore =
      updates.length > 0
        ? Number(
            (
              updates.reduce(
                (
                  total,
                  author
                ) =>
                  total +
                  author
                    .creator_score,
                0
              ) /
              updates.length
            ).toFixed(4)
          )
        : 0;

    /*
     * =========================
     * 6. 完了
     * =========================
     */
    return NextResponse.json({
      ok: true,

      processedPosts:
        allPosts.length,

      processedAuthors:
        updates.length,

      updatedAuthors,

      creatorDistribution: {
        score05Plus:
          creator05,

        score06Plus:
          creator06,

        score07Plus:
          creator07,

        average:
          averageCreatorScore
      },

      sensitiveDistribution: {
        ratio05Plus:
          sensitive05,

        ratio07Plus:
          sensitive07,

        ratio09Plus:
          sensitive09
      },

      message:
        "既存投稿から投稿者シグナルを再構築しました。"
    });
  } catch (error) {
    console.error(
      "REBUILD AUTHOR SIGNALS ERROR:",
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