import {
  NextRequest,
  NextResponse
} from "next/server";

import {
  supabaseAdmin
} from "../../../lib/supabase-admin";

export const runtime = "nodejs";

/*
 * =========================
 * 3000件テスト設定
 * =========================
 */
const TEST_POST_LIMIT = 3000;

/*
 * 1回のBatchで
 * 最大何人までPriority巡回するか
 */
const MAX_PRIORITY_RUNS = 5;

/*
 * 新規率が極端に低い投稿者は
 * クレジット効率が悪いため、
 * 10%未満なら記録する。
 *
 * ただし他の投稿者巡回は続ける。
 */
const MIN_NEW_POST_RATE = 0.10;

/*
 * =========================
 * 認証
 * =========================
 */
function authorized(
  req: NextRequest
) {
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
 * DB投稿数
 * =========================
 */
async function getPostCount() {
  const supabase =
    supabaseAdmin();

  const {
    count,
    error
  } = await supabase
    .from("posts")
    .select(
      "x_post_id",
      {
        count: "exact",
        head: true
      }
    );

  if (error) {
    throw error;
  }

  return count ?? 0;
}

/*
 * =========================
 * 内部API呼び出し
 * =========================
 */
async function callPriorityApi(
  req: NextRequest
) {
  const secret =
    process.env.CRON_SECRET;

  if (!secret) {
    throw new Error(
      "CRON_SECRET is not configured."
    );
  }

  const url =
    new URL(
      "/api/collect-priority",
      req.nextUrl.origin
    );

  const response =
    await fetch(
      url,
      {
        method: "GET",

        headers: {
          Authorization:
            `Bearer ${secret}`
        },

        cache: "no-store"
      }
    );

  const text =
    await response.text();

  let data: any;

  try {
    data =
      JSON.parse(text);
  } catch {
    throw new Error(
      `/api/collect-priority returned invalid JSON: ${text}`
    );
  }

  if (!response.ok) {
    throw new Error(
      `/api/collect-priority failed: ${JSON.stringify(
        data
      )}`
    );
  }

  return data;
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
        error:
          "Unauthorized"
      },
      {
        status: 401
      }
    );
  }

  try {
    /*
     * =========================
     * 開始時点
     * =========================
     */
    const startingPostCount =
      await getPostCount();

    /*
     * 既に3000件なら
     * X APIを一切呼ばない
     */
    if (
      startingPostCount >=
      TEST_POST_LIMIT
    ) {
      return NextResponse.json({
        ok: true,

        stopped: true,

        stopReason:
          "TEST_LIMIT_REACHED",

        startingPostCount,

        currentPostCount:
          startingPostCount,

        addedPosts: 0,

        remainingToLimit: 0,

        runsExecuted: 0,

        testLimit:
          TEST_POST_LIMIT,

        message:
          "既に3000件へ到達しているため、Priority収集は実行していません。"
      });
    }

    /*
     * =========================
     * Batch結果
     * =========================
     */
    const runs:
      any[] = [];

    let stopReason:
      string | null =
      null;

    /*
     * 同一Batch内で
     * 同じ投稿者が選ばれてしまった
     * 場合の検出用。
     */
    const processedAuthorIds =
      new Set<string>();

    /*
     * =========================
     * 最大5回Priority実行
     * =========================
     */
    for (
      let runNumber = 1;
      runNumber <=
        MAX_PRIORITY_RUNS;
      runNumber++
    ) {
      /*
       * 実行前DB件数
       */
      const beforeCount =
        await getPostCount();

      /*
       * 3000件到達
       */
      if (
        beforeCount >=
        TEST_POST_LIMIT
      ) {
        stopReason =
          "TEST_LIMIT_REACHED";

        break;
      }

      /*
       * =========================
       * Priority Collector
       * =========================
       */
      const result =
        await callPriorityApi(
          req
        );

      /*
       * collect-priority自身が
       * 停止した場合
       */
      if (
        result?.stopped ===
        true
      ) {
        runs.push({
          run:
            runNumber,

          result
        });

        stopReason =
          result?.reason ??
          "PRIORITY_STOPPED";

        break;
      }

      const afterCount =
        await getPostCount();

      /*
       * =========================
       * 投稿者
       * =========================
       */
      const authorId =
        String(
          result
            ?.author
            ?.x_author_id ??
            ""
        );

      const username =
        result
          ?.author
          ?.username ??
        null;

      /*
       * =========================
       * 同じ投稿者が
       * Batch内で再度出た場合
       * =========================
       *
       * 本来last_checked_at更新により
       * 次の投稿者へ移るはず。
       *
       * 万一同じ人が再選択されたら
       * 無駄打ち防止で停止。
       */
      if (
        authorId &&
        processedAuthorIds.has(
          authorId
        )
      ) {
        runs.push({
          run:
            runNumber,

          username,

          duplicateAuthor:
            true,

          result
        });

        stopReason =
          "SAME_AUTHOR_SELECTED_AGAIN";

        break;
      }

      if (authorId) {
        processedAuthorIds.add(
          authorId
        );
      }

      /*
       * =========================
       * 収集結果
       * =========================
       */
      const foundPosts =
        Number(
          result
            ?.foundPosts ??
            0
        );

      const newPosts =
        Number(
          result
            ?.newPosts ??
            0
        );

      const duplicatePosts =
        Number(
          result
            ?.duplicatePosts ??
            0
        );

      const savedPosts =
        Number(
          result
            ?.savedPosts ??
            0
        );

      const newPostRate =
        Number(
          result
            ?.newPostRate ??
            0
        );

      const adultPosts =
        Number(
          result
            ?.adultPosts ??
            0
        );

      const creatorPosts =
        Number(
          result
            ?.creatorPosts ??
            0
        );

      const reviewRequiredPosts =
        Number(
          result
            ?.reviewRequiredPosts ??
            0
        );

      /*
       * =========================
       * 成人向け候補率
       * =========================
       */
      const adultRate =
        savedPosts > 0
          ? Number(
              (
                adultPosts /
                savedPosts
              ).toFixed(4)
            )
          : 0;

      /*
       * =========================
       * Creator率
       * =========================
       */
      const creatorRate =
        savedPosts > 0
          ? Number(
              (
                creatorPosts /
                savedPosts
              ).toFixed(4)
            )
          : 0;

      /*
       * =========================
       * Run結果保存
       * =========================
       */
      runs.push({
        run:
          runNumber,

        author: {
          x_author_id:
            authorId || null,

          username,

          name:
            result
              ?.author
              ?.name ??
            null,

          creator_score:
            result
              ?.author
              ?.creator_score ??
            null,

          sensitive_ratio:
            result
              ?.author
              ?.sensitive_ratio ??
            null,

          adult_score:
            result
              ?.author
              ?.adult_score ??
            null,

          cumulative_posts:
            result
              ?.author
              ?.cumulative_posts ??
            null
        },

        foundPosts,

        newPosts,

        duplicatePosts,

        savedPosts,

        newPostRate,

        adultPosts,

        adultRate,

        creatorPosts,

        creatorRate,

        reviewRequiredPosts,

        beforeCount,

        afterCount,

        addedToDatabase:
          Math.max(
            afterCount -
              beforeCount,
            0
          ),

        efficient:
          foundPosts > 0 &&
          newPostRate >=
            MIN_NEW_POST_RATE
      });

      /*
       * =========================
       * 3000件到達
       * =========================
       */
      if (
        afterCount >=
        TEST_POST_LIMIT
      ) {
        stopReason =
          "TEST_LIMIT_REACHED";

        break;
      }

      /*
       * =========================
       * 投稿が0件だった場合
       * =========================
       *
       * 投稿者を変えて
       * 次のRunへ進む。
       */
    }

    /*
     * =========================
     * 最終件数
     * =========================
     */
    const finalPostCount =
      await getPostCount();

    if (
      finalPostCount >=
      TEST_POST_LIMIT
    ) {
      stopReason =
        "TEST_LIMIT_REACHED";
    }

    /*
     * =========================
     * 今回追加数
     * =========================
     */
    const addedPosts =
      Math.max(
        finalPostCount -
          startingPostCount,
        0
      );

    /*
     * =========================
     * 全体集計
     * =========================
     */
    const totalFoundPosts =
      runs.reduce(
        (
          total,
          run
        ) =>
          total +
          Number(
            run.foundPosts ??
              0
          ),
        0
      );

    const totalNewPosts =
      runs.reduce(
        (
          total,
          run
        ) =>
          total +
          Number(
            run.newPosts ??
              0
          ),
        0
      );

    const totalDuplicatePosts =
      runs.reduce(
        (
          total,
          run
        ) =>
          total +
          Number(
            run.duplicatePosts ??
              0
          ),
        0
      );

    const totalAdultPosts =
      runs.reduce(
        (
          total,
          run
        ) =>
          total +
          Number(
            run.adultPosts ??
              0
          ),
        0
      );

    const totalCreatorPosts =
      runs.reduce(
        (
          total,
          run
        ) =>
          total +
          Number(
            run.creatorPosts ??
              0
          ),
        0
      );

    const totalReviewRequiredPosts =
      runs.reduce(
        (
          total,
          run
        ) =>
          total +
          Number(
            run.reviewRequiredPosts ??
              0
          ),
        0
      );

    /*
     * =========================
     * 全体新規率
     * =========================
     */
    const overallNewPostRate =
      totalFoundPosts > 0
        ? Number(
            (
              totalNewPosts /
              totalFoundPosts
            ).toFixed(4)
          )
        : 0;

    /*
     * =========================
     * 高効率投稿者数
     * =========================
     */
    const efficientRuns =
      runs.filter(
        (run) =>
          run.efficient ===
          true
      ).length;

    /*
     * =========================
     * 投稿者効率ランキング
     * =========================
     */
    const authorRanking =
      runs
        .filter(
          (run) =>
            run.author
        )
        .map(
          (run) => ({
            username:
              run.author
                ?.username ??
              null,

            foundPosts:
              run.foundPosts ??
              0,

            newPosts:
              run.newPosts ??
              0,

            newPostRate:
              run.newPostRate ??
              0,

            adultRate:
              run.adultRate ??
              0,

            creatorRate:
              run.creatorRate ??
              0
          })
        )
        .sort(
          (
            a,
            b
          ) => {
            /*
             * まず新規率
             */
            if (
              b.newPostRate !==
              a.newPostRate
            ) {
              return (
                b.newPostRate -
                a.newPostRate
              );
            }

            /*
             * 同じなら新規件数
             */
            return (
              b.newPosts -
              a.newPosts
            );
          }
        );

    /*
     * =========================
     * 完了
     * =========================
     */
    return NextResponse.json({
      ok: true,

      stopped:
        stopReason !== null,

      stopReason:
        stopReason ??
        "MAX_PRIORITY_RUNS_COMPLETED",

      testLimit:
        TEST_POST_LIMIT,

      maxPriorityRuns:
        MAX_PRIORITY_RUNS,

      runsExecuted:
        runs.length,

      startingPostCount,

      currentPostCount:
        finalPostCount,

      addedPosts,

      remainingToLimit:
        Math.max(
          TEST_POST_LIMIT -
            finalPostCount,
          0
        ),

      /*
       * =========================
       * X API効率
       * =========================
       */
      totalFoundPosts,

      totalNewPosts,

      totalDuplicatePosts,

      overallNewPostRate,

      efficientRuns,

      /*
       * =========================
       * 投稿内容
       * =========================
       */
      totalAdultPosts,

      totalCreatorPosts,

      totalReviewRequiredPosts,

      /*
       * =========================
       * 個別Run
       * =========================
       */
      runs,

      /*
       * =========================
       * 投稿者別効率
       * =========================
       */
      authorRanking,

      message:
        finalPostCount >=
        TEST_POST_LIMIT
          ? "3000件テスト上限に到達しました。"
          : "Priority Batchを完了しました。"
    });
  } catch (error) {
    console.error(
      "COLLECT PRIORITY BATCH ERROR:",
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