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

  text:
    string | null;

  possibly_sensitive:
    boolean | null;
};

type PostUpdate = {
  x_post_id: string;

  adult_score:
    number;

  creator_score:
    number;

  review_required:
    boolean;
};

/*
 * =========================
 * GET /api/recount-posts
 * =========================
 *
 * X APIは使用しない。
 *
 * Supabaseに保存済みの
 * 全投稿を再判定する。
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
     * 1. posts全件取得
     * =========================
     */
    const PAGE_SIZE =
      1000;

    let from =
      0;

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
          text,
          possibly_sensitive
        `)
        .order(
          "created_at",
          {
            ascending:
              false
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
        `RECOUNT POSTS FETCH: ${allPosts.length}`
      );

      if (
        page.length <
        PAGE_SIZE
      ) {
        break;
      }

      from +=
        PAGE_SIZE;
    }

    /*
     * =========================
     * 2. 再判定
     * =========================
     */
    const updates:
      PostUpdate[] =
      allPosts.map(
        (post) => {
          const text =
            post.text ?? "";

          const adultScore =
            calculateAdultScore(
              text,
              post
                .possibly_sensitive ??
                false
            );

          const creatorScore =
            calculateCreatorScore(
              text
            );

          const reviewRequired =
            requiresSafetyReview(
              text
            );

          return {
            x_post_id:
              post.x_post_id,

            adult_score:
              adultScore,

            creator_score:
              creatorScore,

            review_required:
              reviewRequired
          };
        }
      );

    /*
     * =========================
     * 3. DB更新
     * =========================
     */
    const BATCH_SIZE =
      20;

    let updatedPosts =
      0;

    for (
      let i = 0;
      i < updates.length;
      i += BATCH_SIZE
    ) {
      const batch =
        updates.slice(
          i,
          i +
            BATCH_SIZE
        );

      const results =
        await Promise.all(
          batch.map(
            async (
              post
            ) => {
              const {
                error
              } =
                await supabase
                  .from("posts")
                  .update({
                    adult_score:
                      post
                        .adult_score,

                    creator_score:
                      post
                        .creator_score,

                    review_required:
                      post
                        .review_required
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
        `RECOUNT POSTS UPDATE: ${updatedPosts}/${updates.length}`
      );
    }

    /*
     * =========================
     * 4. adult集計
     * =========================
     */

    const adultCandidates =
      updates.filter(
        (post) =>
          post.adult_score >=
            0.55 &&
          !post.review_required
      ).length;

    const strongAdultCandidates =
      updates.filter(
        (post) =>
          post.adult_score >=
            0.7 &&
          !post.review_required
      ).length;

    /*
     * =========================
     * 5. creator集計
     * =========================
     */

    const creatorCandidates =
      updates.filter(
        (post) =>
          post.creator_score >=
            0.25 &&
          !post.review_required
      ).length;

    const strongCreatorCandidates =
      updates.filter(
        (post) =>
          post.creator_score >=
            0.5 &&
          !post.review_required
      ).length;

    /*
     * 成人向け
     * ＋
     * Creator系
     */
    const adultCreatorCandidates =
      updates.filter(
        (post) =>
          post.adult_score >=
            0.4 &&
          post.creator_score >=
            0.25 &&
          !post.review_required
      ).length;

    /*
     * =========================
     * 6. Safety
     * =========================
     */
    const reviewRequiredPosts =
      updates.filter(
        (post) =>
          post.review_required
      ).length;

    /*
     * =========================
     * 7. 分布
     * =========================
     */

    const adultScoreZero =
      updates.filter(
        (post) =>
          post.adult_score ===
          0
      ).length;

    const creatorScoreZero =
      updates.filter(
        (post) =>
          post.creator_score ===
          0
      ).length;

    /*
     * =========================
     * 8. 平均
     * =========================
     */

    const averageAdultScore =
      updates.length > 0
        ? Number(
            (
              updates.reduce(
                (
                  total,
                  post
                ) =>
                  total +
                  post.adult_score,
                0
              ) /
              updates.length
            ).toFixed(4)
          )
        : 0;

    const averageCreatorScore =
      updates.length > 0
        ? Number(
            (
              updates.reduce(
                (
                  total,
                  post
                ) =>
                  total +
                  post.creator_score,
                0
              ) /
              updates.length
            ).toFixed(4)
          )
        : 0;

    /*
     * =========================
     * 9. 完了
     * =========================
     */
    return NextResponse.json({
      ok: true,

      processedPosts:
        allPosts.length,

      updatedPosts,

      adult: {
        candidates:
          adultCandidates,

        strongCandidates:
          strongAdultCandidates,

        scoreZero:
          adultScoreZero,

        averageScore:
          averageAdultScore
      },

      creator: {
        candidates:
          creatorCandidates,

        strongCandidates:
          strongCreatorCandidates,

        scoreZero:
          creatorScoreZero,

        averageScore:
          averageCreatorScore
      },

      /*
       * ここが特に重要
       */
      adultCreatorCandidates,

      reviewRequiredPosts,

      message:
        "adult_score / creator_score の再判定が完了しました。"
    });
  } catch (error) {
    console.error(
      "RECOUNT POSTS ERROR:",
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