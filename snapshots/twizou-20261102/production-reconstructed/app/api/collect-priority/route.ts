import { NextRequest, NextResponse } from "next/server";
import { searchRecentVideoPosts } from "../../../lib/x";
import { supabaseAdmin } from "../../../lib/supabase-admin";
import { rankingScore } from "../../../lib/ranking";
import {
  calculateAdultScore,
  calculateCreatorScore,
  requiresSafetyReview
} from "../../../lib/adult-score";

export const runtime = "nodejs";

/*
 * =========================
 * 5000件テスト設定
 * =========================
 */
const TEST_POST_LIMIT = 3000;

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
 * Priority Collector
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

    const now =
      new Date().toISOString();

    /*
     * =========================
     * 1. 現在の投稿数確認
     * =========================
     *
     * X APIを呼ぶ前に確認する。
     */
    const {
      count: beforeCount,
      error: countError
    } = await supabase
      .from("posts")
      .select(
        "x_post_id",
        {
          count: "exact",
          head: true
        }
      );

    if (countError) {
      throw countError;
    }

    const currentPostCount =
      beforeCount ?? 0;

    /*
     * =========================
     * 5000件到達済み
     *
     * X APIを呼ばず終了
     * =========================
     */
    if (
      currentPostCount >=
      TEST_POST_LIMIT
    ) {
      return NextResponse.json({
        ok: true,

        stopped: true,

        reason:
          "TEST_LIMIT_REACHED",

        currentPostCount,

        testLimit:
          TEST_POST_LIMIT,

        remainingTo5000: 0,

        message:
          "5000件テスト上限に到達しているため、X APIは呼び出していません。"
      });
    }

    /*
     * =========================
     * 2. Priority投稿者を選択
     * =========================
     *
     * creator_scoreを優先。
     *
     * ただし従来の
     * adult_scoreも利用する。
     * =========================
     */
    const {
      data: authors,
      error: authorError
    } = await supabase
      .from("authors")
      .select(`
        x_author_id,
        username,
        name,

        cumulative_posts,
        cumulative_video_posts,

        adult_score,
        creator_score,
        sensitive_ratio,

        video_ratio,
        avg_views,

        priority,
        review_required,

        last_checked_at
      `)
      .eq(
        "review_required",
        false
      )
      .not(
        "username",
        "is",
        null
      )
      .or(
        "creator_score.gte.0.5,adult_score.gte.0.55,sensitive_ratio.gte.0.7"
      )
      /*
       * まず長期間チェックしていない
       * 投稿者を優先
       */
      .order(
        "last_checked_at",
        {
          ascending: true,
          nullsFirst: true
        }
      )
      /*
       * creator候補を優先
       */
      .order(
        "creator_score",
        {
          ascending: false
        }
      )
      /*
       * sensitive率
       */
      .order(
        "sensitive_ratio",
        {
          ascending: false
        }
      )
      /*
       * 従来adult_score
       */
      .order(
        "adult_score",
        {
          ascending: false
        }
      )
      /*
       * 最後にpriority
       */
      .order(
        "priority",
        {
          ascending: false
        }
      )
      .limit(1);

    if (authorError) {
      throw authorError;
    }

    if (
      !authors ||
      authors.length === 0
    ) {
      return NextResponse.json({
        ok: true,

        stopped: true,

        reason:
          "NO_PRIORITY_AUTHOR",

        currentPostCount,

        remainingTo5000:
          Math.max(
            TEST_POST_LIMIT -
              currentPostCount,
            0
          ),

        message:
          "Priority収集対象の投稿者がいません。"
      });
    }

    const author =
      authors[0];

    if (!author.username) {
      throw new Error(
        "Priority author has no username."
      );
    }

    /*
     * =========================
     * 3. 投稿者専用X検索
     * =========================
     */
    const searchQuery =
      `from:${author.username} has:videos -is:retweet`;

    console.log(
      "PRIORITY SEARCH:",
      {
        username:
          author.username,

        creatorScore:
          author.creator_score,

        sensitiveRatio:
          author.sensitive_ratio,

        adultScore:
          author.adult_score,

        cumulativePosts:
          author.cumulative_posts,

        lastCheckedAt:
          author.last_checked_at,

        currentPostCount,

        query:
          searchQuery
      }
    );

    /*
     * =========================
     * 4. X API
     * =========================
     */
    const posts =
      await searchRecentVideoPosts(
        searchQuery,
        100,
        undefined,
        "priority"
      );

    const foundPosts =
      posts.length;

    /*
     * =========================
     * 5. 既存投稿ID確認
     * =========================
     */
    const fetchedPostIds =
      posts.map(
        (post) =>
          post.x_post_id
      );

    const existingIdSet =
      new Set<string>();

    if (
      fetchedPostIds.length > 0
    ) {
      const {
        data: existingPosts,
        error: existingError
      } = await supabase
        .from("posts")
        .select(
          "x_post_id"
        )
        .in(
          "x_post_id",
          fetchedPostIds
        );

      if (existingError) {
        throw existingError;
      }

      for (
        const post of
        existingPosts ?? []
      ) {
        existingIdSet.add(
          post.x_post_id
        );
      }
    }

    /*
     * =========================
     * 6. 新規 / 重複を計算
     * =========================
     */
    const newPosts =
      posts.filter(
        (post) =>
          !existingIdSet.has(
            post.x_post_id
          )
      );

    const duplicatePosts =
      foundPosts -
      newPosts.length;

    /*
     * =========================
     * 5000件を超えないよう
     * 新規投稿を制限
     * =========================
     */
    const availableSlots =
      Math.max(
        TEST_POST_LIMIT -
          currentPostCount,
        0
      );

    const newPostsToSave =
      newPosts.slice(
        0,
        availableSlots
      );

    /*
     * =========================
     * 7. 投稿スコア作成
     * =========================
     */
    const rows =
      newPostsToSave.map(
        (post) => {
          const adultScore =
            calculateAdultScore(
              post.text ?? "",
              post
                .possibly_sensitive ??
                false
            );

          const creatorScore =
            calculateCreatorScore(
              post.text ?? ""
            );

          const reviewRequired =
            requiresSafetyReview(
              post.text ?? ""
            );

          return {
            ...post,

            /*
             * 成人向け候補
             */
            adult_score:
              adultScore,

            /*
             * Creator候補
             */
            creator_score:
              creatorScore,

            /*
             * Safety確認
             */
            review_required:
              reviewRequired,

            /*
             * 投稿者統計は
             * まだ未反映
             */
            author_stats_counted:
              false,

            last_seen_at:
              now,

            /*
             * 人気ランキング
             */
            score:
              rankingScore({
                views:
                  post.views,

                likes:
                  post.likes,

                reposts:
                  post.reposts,

                replies:
                  post.replies,

                createdAt:
                  post.created_at
              })
          };
        }
      );

    /*
     * =========================
     * 8. posts保存
     * =========================
     */
    if (
      rows.length > 0
    ) {
      const {
        error: postError
      } = await supabase
        .from("posts")
        .upsert(
          rows,
          {
            onConflict:
              "x_post_id"
          }
        );

      if (postError) {
        throw postError;
      }

      /*
       * =========================
       * metric_snapshots
       * =========================
       */
      const snapshots =
        rows.map(
          (post) => ({
            x_post_id:
              post.x_post_id,

            measured_at:
              now,

            views:
              post.views,

            likes:
              post.likes,

            reposts:
              post.reposts,

            replies:
              post.replies,

            score:
              post.score
          })
        );

      const {
        error: metricsError
      } = await supabase
        .from(
          "metric_snapshots"
        )
        .insert(
          snapshots
        );

      if (metricsError) {
        throw metricsError;
      }
    }

    /*
     * =========================
     * 9. last_checked_at更新
     * =========================
     */
    const {
      error: checkedError
    } = await supabase
      .from("authors")
      .update({
        last_checked_at:
          now
      })
      .eq(
        "x_author_id",
        author.x_author_id
      );

    if (checkedError) {
      throw checkedError;
    }

    /*
     * =========================
     * 10. 保存後の投稿数
     * =========================
     */
    const {
      count: afterCount,
      error: afterCountError
    } = await supabase
      .from("posts")
      .select(
        "x_post_id",
        {
          count: "exact",
          head: true
        }
      );

    if (afterCountError) {
      throw afterCountError;
    }

    const finalPostCount =
      afterCount ??
      (
        currentPostCount +
        rows.length
      );

    /*
     * =========================
     * 新規取得効率
     * =========================
     */
    const newPostRate =
      foundPosts > 0
        ? Number(
            (
              newPosts.length /
              foundPosts
            ).toFixed(4)
          )
        : 0;

    /*
     * =========================
     * 11. 結果
     * =========================
     */
    return NextResponse.json({
      ok: true,

      stopped: false,

      author: {
        x_author_id:
          author.x_author_id,

        username:
          author.username,

        name:
          author.name,

        creator_score:
          author.creator_score,

        sensitive_ratio:
          author.sensitive_ratio,

        adult_score:
          author.adult_score,

        cumulative_posts:
          author.cumulative_posts,

        priority:
          author.priority,

        previous_last_checked_at:
          author.last_checked_at,

        new_last_checked_at:
          now
      },

      searchQuery,

      /*
       * X APIから返った件数
       */
      foundPosts,

      /*
       * DB未登録だった件数
       */
      newPosts:
        newPosts.length,

      /*
       * DB登録済みだった件数
       */
      duplicatePosts,

      /*
       * 実際に保存した件数
       */
      savedPosts:
        rows.length,

      /*
       * 新規率
       */
      newPostRate,

      /*
       * DB件数
       */
      previousPostCount:
        currentPostCount,

      currentPostCount:
        finalPostCount,

      /*
       * 5000件まで残り
       */
      remainingTo5000:
        Math.max(
          TEST_POST_LIMIT -
            finalPostCount,
          0
        ),

      testLimit:
        TEST_POST_LIMIT,

      /*
       * 今回保存した動画の
       * スコア確認
       */
      adultPosts:
        rows.filter(
          (post) =>
            post.adult_score >=
            0.55
        ).length,

      creatorPosts:
        rows.filter(
          (post) =>
            post.creator_score >=
            0.5
        ).length,

      reviewRequiredPosts:
        rows.filter(
          (post) =>
            post.review_required
        ).length,

      averageAdultScore:
        rows.length > 0
          ? Number(
              (
                rows.reduce(
                  (
                    total,
                    post
                  ) =>
                    total +
                    post.adult_score,
                  0
                ) /
                rows.length
              ).toFixed(4)
            )
          : 0,

      averageCreatorScore:
        rows.length > 0
          ? Number(
              (
                rows.reduce(
                  (
                    total,
                    post
                  ) =>
                    total +
                    post.creator_score,
                  0
                ) /
                rows.length
              ).toFixed(4)
            )
          : 0
    });
  } catch (error) {
    console.error(
      "COLLECT PRIORITY ERROR:",
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
