import { NextRequest, NextResponse } from "next/server";
import { searchRecentVideoPosts } from "../../../lib/x";
import { supabaseAdmin } from "../../../lib/supabase-admin";
import { rankingScore } from "../../../lib/ranking";
import {
  calculateAdultScore,
  calculateCreatorScore,
  requiresSafetyReview
} from "../../../lib/adult-score";
import {
  classifyContent
} from "../../../lib/content-filter";

export const runtime = "nodejs";

/*
 * 2026-09-04 09:00 JSTから7回だけ行う広域探索。
 * X Recent Searchの1リクエスト上限と同じ100件に制限する。
 */
const DISCOVERY_DAILY_LIMIT = 100;
const DISCOVERY_TRIAL_END_AT = "2026-09-11T00:00:00+09:00";

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
    req.headers.get("authorization");

  const querySecret =
    req.nextUrl.searchParams.get(
      "secret"
    );

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
type UncountedPost = {
  x_post_id: string;

  author_id: string | null;
  author_username: string | null;
  author_name: string | null;

  text: string | null;

  possibly_sensitive:
    boolean | null;

  adult_score:
    number | null;

  creator_score:
    number | null;

  review_required:
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

type ExistingAuthor = {
  x_author_id:
    string;

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

  review_required:
    boolean | null;
};

type PendingClassificationPost = {
  x_post_id: string;
  author_id: string | null;
  text: string | null;
  possibly_sensitive: boolean | null;
  adult_score: number | null;
  creator_score: number | null;
  review_required: boolean | null;
  content_category: string | null;
  content_filter_score: number | null;
  content_filter_reason: string | null;
};

type TierAuthor = {
  x_author_id: string;
  adult_score: number | null;
  creator_score: number | null;
  sensitive_ratio: number | null;
  cumulative_posts: number | null;
  cumulative_video_posts: number | null;
  video_ratio: number | null;
  review_required: boolean | null;
};

function calculateTier(
  post: PendingClassificationPost,
  author: TierAuthor | undefined
) {
  const sensitive =
    post.possibly_sensitive === true;

  const postAdultScore =
    Number(post.adult_score ?? 0);

  const postCreatorScore =
    Number(post.creator_score ?? 0);

  const authorAdultScore =
    Number(author?.adult_score ?? 0);

  const authorCreatorScore =
    Number(author?.creator_score ?? 0);

  const sensitiveRatio =
    Number(author?.sensitive_ratio ?? 0);

  const cumulativePosts =
    Number(author?.cumulative_posts ?? 0);

  const cumulativeVideoPosts =
    Number(
      author?.cumulative_video_posts ?? 0
    );

  const videoRatio =
    Number(author?.video_ratio ?? 0);

  if (
    post.review_required ||
    author?.review_required
  ) {
    return { score: 0, tier: "X" };
  }

  if (
    sensitive &&
    authorCreatorScore >= 0.7 &&
    sensitiveRatio >= 0.8 &&
    cumulativePosts >= 5 &&
    videoRatio >= 0.8
  ) {
    return { score: 0.95, tier: "S" };
  }

  if (
    sensitive &&
    postCreatorScore >= 0.5 &&
    authorCreatorScore >= 0.5
  ) {
    return { score: 0.92, tier: "S" };
  }

  if (
    sensitive &&
    authorCreatorScore >= 0.6 &&
    sensitiveRatio >= 0.7 &&
    cumulativePosts >= 3
  ) {
    return { score: 0.86, tier: "A+" };
  }

  if (
    sensitive &&
    authorCreatorScore >= 0.5 &&
    cumulativePosts >= 2
  ) {
    return { score: 0.8, tier: "A" };
  }

  if (
    sensitive &&
    postCreatorScore >= 0.25
  ) {
    return { score: 0.78, tier: "A" };
  }

  if (
    sensitive &&
    authorAdultScore >= 0.55 &&
    cumulativePosts >= 5 &&
    cumulativeVideoPosts >= 4 &&
    videoRatio >= 0.8
  ) {
    return { score: 0.72, tier: "B+" };
  }

  if (
    sensitive &&
    sensitiveRatio >= 0.8 &&
    cumulativePosts >= 3
  ) {
    return { score: 0.67, tier: "B" };
  }

  if (
    sensitive &&
    postAdultScore > 0.42
  ) {
    return { score: 0.63, tier: "B" };
  }

  if (sensitive) {
    return { score: 0.55, tier: "C" };
  }

  if (postAdultScore >= 0.7) {
    return { score: 0.5, tier: "D+" };
  }

  if (
    authorCreatorScore >= 0.6 &&
    cumulativePosts >= 5
  ) {
    return { score: 0.42, tier: "D" };
  }

  if (postCreatorScore >= 0.5) {
    return { score: 0.35, tier: "D" };
  }

  return { score: 0, tier: "NONE" };
}

/*
 * =========================
 * GET
 * =========================
 */
export async function GET(
  req: NextRequest
) {
  /*
   * =========================
   * 認証
   * =========================
   */
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

  /*
   * 広域探索はX APIクレジット節約のため停止中。
   * 再開する場合だけ、環境変数 DISCOVERY_ENABLED=true を設定する。
   */
  if (process.env.DISCOVERY_ENABLED !== "true") {
    return NextResponse.json({
      ok: true,
      stopped: true,
      reason: "DISCOVERY_DISABLED",
      message: "広域探索は停止中のため、X APIは呼び出していません。"
    });
  }

  try {
    const supabase =
      supabaseAdmin();

    const now =
      new Date().toISOString();

    if (Date.now() >= Date.parse(DISCOVERY_TRIAL_END_AT)) {
      return NextResponse.json({
        ok: true,
        stopped: true,
        reason: "DISCOVERY_TRIAL_ENDED",
        trialEndAt: DISCOVERY_TRIAL_END_AT,
        message: "7日間の広域探索試験が終了しているため、X APIは呼び出していません。"
      });
    }

    /*
     * =========================
     * 1. 検索クエリ決定
     * =========================
     *
     * ?query= がある場合
     * それを優先する。
     *
     * 無い場合は従来通り
     * X_SEARCH_QUERYを使用。
     */
    const requestedQuery =
      req.nextUrl.searchParams.get(
        "query"
      );

    const searchQuery =
      requestedQuery?.trim() ||
      process.env.X_SEARCH_QUERY?.trim() ||
      "動画 has:videos -is:retweet lang:ja";

    /*
     * =========================
     * 2. 現在の投稿数
     * =========================
     *
     * X APIを呼ぶ前に確認。
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
     * 3. X API
     * =========================
     */
    const posts =
      await searchRecentVideoPosts(
        searchQuery,
        DISCOVERY_DAILY_LIMIT
      );

    const foundPosts =
      posts.length;

    /*
     * =========================
     * 4. 既存投稿ID確認
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
     * 5. 新規 / 重複
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

    const newPostsToSave =
      newPosts.slice(
        0,
        DISCOVERY_DAILY_LIMIT
      );

    /*
     * =========================
     * 7. 投稿スコア
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

            adult_score:
              adultScore,

            creator_score:
              creatorScore,

            review_required:
              reviewRequired,

            /*
             * 投稿者統計は
             * 未集計状態で保存
             */
            author_stats_counted:
              false,

            collection_source:
              "discovery",

            last_seen_at:
              now,

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
        error: upsertError
      } = await supabase
        .from("posts")
        .upsert(
          rows,
          {
            onConflict:
              "x_post_id"
          }
        );

      if (upsertError) {
        throw upsertError;
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
     * 9. 未集計投稿取得
     * =========================
     */
    const {
      data: uncountedData,
      error: uncountedError
    } = await supabase
      .from("posts")
      .select(`
        x_post_id,
        author_id,
        author_username,
        author_name,
        text,
        possibly_sensitive,
        adult_score,
        creator_score,
        review_required,
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

    if (uncountedError) {
      throw uncountedError;
    }

    const uncountedPosts =
      (
        uncountedData ?? []
      ) as UncountedPost[];

    /*
     * =========================
     * 10. 投稿者差分集計
     * =========================
     */
    const authorDeltaMap =
      new Map<
        string,
        {
          x_author_id:
            string;

          username:
            string | null;

          name:
            string | null;

          posts:
            number;

          video_posts:
            number;

          adult_score_sum:
            number;

          views:
            number;

          likes:
            number;

          reposts:
            number;

          review_required:
            boolean;
        }
      >();

    for (
      const post of
      uncountedPosts
    ) {
      if (!post.author_id) {
        continue;
      }

      const postAdultScore =
        Number(
          post.adult_score ??
            0
        );

      const postNeedsReview =
        Boolean(
          post.review_required
        );

      const existing =
        authorDeltaMap.get(
          post.author_id
        );

      if (existing) {
        existing.posts += 1;

        existing.video_posts +=
          post.media_key
            ? 1
            : 0;

        existing.adult_score_sum +=
          postAdultScore;

        existing.views +=
          post.views ?? 0;

        existing.likes +=
          post.likes ?? 0;

        existing.reposts +=
          post.reposts ?? 0;

        existing.review_required =
          existing.review_required ||
          postNeedsReview;
      } else {
        authorDeltaMap.set(
          post.author_id,
          {
            x_author_id:
              post.author_id,

            username:
              post.author_username,

            name:
              post.author_name,

            posts:
              1,

            video_posts:
              post.media_key
                ? 1
                : 0,

            adult_score_sum:
              postAdultScore,

            views:
              post.views ?? 0,

            likes:
              post.likes ?? 0,

            reposts:
              post.reposts ?? 0,

            review_required:
              postNeedsReview
          }
        );
      }
    }

    const authorIds =
      Array.from(
        authorDeltaMap.keys()
      );

    /*
     * =========================
     * 11. 既存authors取得
     * =========================
     */
    let existingAuthors:
      ExistingAuthor[] = [];

    if (
      authorIds.length > 0
    ) {
      const {
        data: existingData,
        error: existingError
      } = await supabase
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
          review_required
        `)
        .in(
          "x_author_id",
          authorIds
        );

      if (existingError) {
        throw existingError;
      }

      existingAuthors =
        (
          existingData ?? []
        ) as ExistingAuthor[];
    }

    const existingAuthorMap =
      new Map(
        existingAuthors.map(
          (author) => [
            author.x_author_id,
            author
          ]
        )
      );

    /*
     * =========================
     * 12. 累積値更新
     * =========================
     */
    const authors =
      Array.from(
        authorDeltaMap.values()
      ).map(
        (delta) => {
          const old =
            existingAuthorMap.get(
              delta.x_author_id
            );

          const cumulativePosts =
            Number(
              old
                ?.cumulative_posts ??
                0
            ) +
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
              (
                Number(
                  old
                    ?.cumulative_adult_score ??
                    0
                ) +
                delta.adult_score_sum
              ).toFixed(4)
            );

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
           * =========================
           * 投稿者指標
           * =========================
           */
          const videoRatio =
            cumulativePosts > 0
              ? cumulativeVideoPosts /
                cumulativePosts
              : 0;

          const adultScore =
            cumulativePosts > 0
              ? cumulativeAdultScore /
                cumulativePosts
              : 0;

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
           * videoRatio 最大3
           * adultScore 最大5
           * views 最大3
           *
           * 最大11
           */
          const priority =
            Math.round(
              videoRatio * 3
            ) +
            Math.round(
              adultScore * 5
            ) +
            (
              avgViews >= 100000
                ? 3
                : avgViews >= 10000
                ? 2
                : avgViews >= 1000
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
             * 通常値
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
             * 累積値
             */
            cumulative_posts:
              cumulativePosts,

            cumulative_video_posts:
              cumulativeVideoPosts,

            cumulative_adult_score:
              cumulativeAdultScore,

            cumulative_views:
              cumulativeViews,

            cumulative_likes:
              cumulativeLikes,

            cumulative_reposts:
              cumulativeReposts,

            last_seen_at:
              now,

            /*
             * 既存投稿者の
             * last_checked_atは
             * 上書きしない。
             */
            last_checked_at:
              old
                ? undefined
                : null
          };
        }
      );

    /*
     * =========================
     * undefined除去
     * =========================
     */
    const cleanAuthors =
      authors.map(
        (author) => {
          const {
            last_checked_at,
            ...rest
          } = author;

          if (
            last_checked_at ===
            undefined
          ) {
            return rest;
          }

          return {
            ...rest,
            last_checked_at
          };
        }
      );

    /*
     * =========================
     * 13. authors保存
     * =========================
     */
    if (
      cleanAuthors.length > 0
    ) {
      const {
        error: authorError
      } = await supabase
        .from("authors")
        .upsert(
          cleanAuthors,
          {
            onConflict:
              "x_author_id"
          }
        );

      if (authorError) {
        throw authorError;
      }
    }

    /*
     * =========================
     * 14. 未判定投稿を自動分類
     * =========================
     *
     * 収集直後の投稿にtierと
     * content filterを保存する。
     * 前回途中で止まった未判定分も
     * 次回実行時に回収する。
     */
    const {
      data: pendingData,
      error: pendingError
    } = await supabase
      .from("posts")
      .select(`
        x_post_id,
        author_id,
        text,
        possibly_sensitive,
        adult_score,
        creator_score,
        review_required,
        content_category,
        content_filter_score,
        content_filter_reason
      `)
      .is(
        "adult_tier",
        null
      )
      .limit(1000);

    if (pendingError) {
      throw pendingError;
    }

    const pendingPosts =
      (pendingData ?? []) as
        PendingClassificationPost[];

    const pendingAuthorIds =
      Array.from(
        new Set(
          pendingPosts
            .map(
              (post) =>
                post.author_id
            )
            .filter(
              (
                authorId
              ): authorId is string =>
                Boolean(authorId)
            )
        )
      );

    let tierAuthors:
      TierAuthor[] = [];

    if (
      pendingAuthorIds.length > 0
    ) {
      const {
        data: tierAuthorData,
        error: tierAuthorError
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
        `)
        .in(
          "x_author_id",
          pendingAuthorIds
        );

      if (tierAuthorError) {
        throw tierAuthorError;
      }

      tierAuthors =
        (tierAuthorData ?? []) as
          TierAuthor[];
    }

    const tierAuthorMap =
      new Map(
        tierAuthors.map(
          (author) => [
            author.x_author_id,
            author
          ]
        )
      );

    const classificationGroups =
      new Map<
        string,
        {
          values: {
            effective_adult_score:
              number;
            adult_tier:
              string;
            content_category:
              string;
            content_filter_score:
              number;
            content_filter_reason:
              string;
          };
          ids: string[];
        }
      >();

    const classificationTierCounts:
      Record<string, number> = {};

    for (
      const post of pendingPosts
    ) {
      const author =
        post.author_id
          ? tierAuthorMap.get(
              post.author_id
            )
          : undefined;

      const tierResult =
        calculateTier(
          post,
          author
        );

      const classified =
        classifyContent(
          post.text ?? ""
        );

      const preserveSafety =
        post.content_category ===
          "SAFETY_REVIEW";

      const values = {
        effective_adult_score:
          Number(
            tierResult.score.toFixed(
              4
            )
          ),
        adult_tier:
          tierResult.tier,
        content_category:
          preserveSafety
            ? "SAFETY_REVIEW"
            : classified.category,
        content_filter_score:
          preserveSafety
            ? post
                .content_filter_score ??
              1
            : classified.score,
        content_filter_reason:
          preserveSafety
            ? post
                .content_filter_reason ??
              "安全確認が必要"
            : classified.reason
      };

      const groupKey =
        JSON.stringify(values);

      const group =
        classificationGroups.get(
          groupKey
        );

      if (group) {
        group.ids.push(
          post.x_post_id
        );
      } else {
        classificationGroups.set(
          groupKey,
          {
            values,
            ids: [
              post.x_post_id
            ]
          }
        );
      }

      classificationTierCounts[
        tierResult.tier
      ] =
        (
          classificationTierCounts[
            tierResult.tier
          ] ?? 0
        ) + 1;
    }

    const CLASSIFICATION_BATCH_SIZE =
      50;

    let classifiedPosts = 0;

    for (
      const group of
      classificationGroups.values()
    ) {
      for (
        let index = 0;
        index < group.ids.length;
        index +=
          CLASSIFICATION_BATCH_SIZE
      ) {
        const ids =
          group.ids.slice(
            index,
            index +
              CLASSIFICATION_BATCH_SIZE
          );

        const {
          data: updatedData,
          error: updateError
        } = await supabase
          .from("posts")
          .update(
            group.values
          )
          .in(
            "x_post_id",
            ids
          )
          .select(
            "x_post_id"
          );

        if (updateError) {
          throw updateError;
        }

        if (
          (updatedData ?? [])
            .length !== ids.length
        ) {
          throw new Error(
            "投稿の自動分類更新件数が一致しません。"
          );
        }

        classifiedPosts +=
          ids.length;
      }
    }

    /*
     * =========================
     * 15. 集計済みフラグ
     * =========================
     */
    const countedPostIds =
      uncountedPosts.map(
        (post) =>
          post.x_post_id
      );

    if (
      countedPostIds.length > 0
    ) {
      const {
        error: countedError
      } = await supabase
        .from("posts")
        .update({
          author_stats_counted:
            true
        })
        .in(
          "x_post_id",
          countedPostIds
        );

      if (countedError) {
        throw countedError;
      }
    }

    /*
     * =========================
     * 16. 保存後DB件数
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
     * 17. 収集効率
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

    const duplicateRate =
      foundPosts > 0
        ? Number(
            (
              duplicatePosts /
              foundPosts
            ).toFixed(4)
          )
        : 0;

    /*
     * =========================
     * 17. 結果
     * =========================
     */
    return NextResponse.json({
      ok: true,

      stopped: false,

      /*
       * 実際に使った検索語
       */
      query:
        searchQuery,

      /*
       * X API
       */
      foundPosts,

      /*
       * DB未登録
       */
      newPosts:
        newPosts.length,

      /*
       * DB登録済み
       */
      duplicatePosts,

      /*
       * 実保存数
       */
      savedPosts:
        rows.length,

      /*
       * 効率
       */
      newPostRate,

      duplicateRate,

      /*
       * 投稿者統計
       */
      newlyCountedPosts:
        uncountedPosts.length,

      updatedAuthors:
        cleanAuthors.length,

      /*
       * 自動tier・除外分類
       */
      classifiedPosts,

      classificationTierCounts,

      /*
       * DB件数
       */
      previousPostCount:
        currentPostCount,

      currentPostCount:
        finalPostCount,

      discoveryDailyLimit:
        DISCOVERY_DAILY_LIMIT,

      trialEndAt:
        DISCOVERY_TRIAL_END_AT,

      /*
       * 投稿スコア
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
          : 0,

      message:
        "指定クエリで通常探索が完了しました。"
    });
  } catch (error) {
    console.error(
      "COLLECT ERROR:",
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
