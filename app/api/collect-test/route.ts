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
 * 新規率10%未満は低効率扱い
 */
const MIN_NEW_POST_RATE = 0.10;

/*
 * =========================
 * 仕上げ用検索Query
 * =========================
 *
 * 既存クエリと少し表現をずらして
 * 新しい集合を狙う。
 */
const SEARCH_QUERIES = [
  "アダルト作品 has:videos -is:retweet lang:ja",

  "R18作品 has:videos -is:retweet lang:ja",

  "成人作品 has:videos -is:retweet lang:ja",

  "自主制作動画 has:videos -is:retweet lang:ja"
];

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
 * 内部API
 * =========================
 */
async function callInternalApi(
  req: NextRequest,
  path: string,
  params?: Record<
    string,
    string
  >
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
      path,
      req.nextUrl.origin
    );

  if (params) {
    for (
      const [
        key,
        value
      ] of Object.entries(
        params
      )
    ) {
      url.searchParams.set(
        key,
        value
      );
    }
  }

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
      `${path} returned invalid JSON: ${text}`
    );
  }

  if (!response.ok) {
    throw new Error(
      `${path} failed: ${JSON.stringify(
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
    /*
     * 開始時点
     */
    const startingPostCount =
      await getPostCount();

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

        queriesExecuted: 0,

        testLimit:
          TEST_POST_LIMIT,

        message:
          "既に3000件へ到達しています。"
      });
    }

    const queryResults:
      any[] = [];

    let stopReason:
      string | null =
      null;

    /*
     * =========================
     * Queryローテーション
     * =========================
     */
    for (
      const searchQuery of
      SEARCH_QUERIES
    ) {
      const beforeCount =
        await getPostCount();

      if (
        beforeCount >=
        TEST_POST_LIMIT
      ) {
        stopReason =
          "TEST_LIMIT_REACHED";

        break;
      }

      const result =
        await callInternalApi(
          req,
          "/api/collect",
          {
            query:
              searchQuery
          }
        );

      const afterCount =
        await getPostCount();

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

      const adultRate =
        newPosts > 0
          ? Number(
              (
                adultPosts /
                newPosts
              ).toFixed(4)
            )
          : 0;

      const creatorRate =
        newPosts > 0
          ? Number(
              (
                creatorPosts /
                newPosts
              ).toFixed(4)
            )
          : 0;

      queryResults.push({
        query:
          searchQuery,

        foundPosts,

        newPosts,

        duplicatePosts,

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

      if (
        afterCount >=
        TEST_POST_LIMIT
      ) {
        stopReason =
          "TEST_LIMIT_REACHED";

        break;
      }
    }

    /*
     * =========================
     * Priorityを最後に1回
     * =========================
     */
    let priorityResult:
      any = null;

    const countBeforePriority =
      await getPostCount();

    if (
      countBeforePriority <
      TEST_POST_LIMIT
    ) {
      priorityResult =
        await callInternalApi(
          req,
          "/api/collect-priority"
        );
    }

    /*
     * 最終件数
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

    const addedPosts =
      Math.max(
        finalPostCount -
          startingPostCount,
        0
      );

    /*
     * =========================
     * 通常探索集計
     * =========================
     */
    const totalFoundPosts =
      queryResults.reduce(
        (
          total,
          item
        ) =>
          total +
          item.foundPosts,
        0
      );

    const totalNewPosts =
      queryResults.reduce(
        (
          total,
          item
        ) =>
          total +
          item.newPosts,
        0
      );

    const totalDuplicatePosts =
      queryResults.reduce(
        (
          total,
          item
        ) =>
          total +
          item.duplicatePosts,
        0
      );

    const totalAdultPosts =
      queryResults.reduce(
        (
          total,
          item
        ) =>
          total +
          item.adultPosts,
        0
      );

    const totalCreatorPosts =
      queryResults.reduce(
        (
          total,
          item
        ) =>
          total +
          item.creatorPosts,
        0
      );

    /*
     * Priority加算
     */
    const priorityFound =
      Number(
        priorityResult
          ?.foundPosts ??
          0
      );

    const priorityNew =
      Number(
        priorityResult
          ?.newPosts ??
          0
      );

    const priorityDuplicate =
      Number(
        priorityResult
          ?.duplicatePosts ??
          0
      );

    const combinedFound =
      totalFoundPosts +
      priorityFound;

    const combinedNew =
      totalNewPosts +
      priorityNew;

    const combinedDuplicate =
      totalDuplicatePosts +
      priorityDuplicate;

    const overallNewPostRate =
      combinedFound > 0
        ? Number(
            (
              combinedNew /
              combinedFound
            ).toFixed(4)
          )
        : 0;

    /*
     * =========================
     * 成人向け率ランキング
     * =========================
     */
    const queryRanking =
      [...queryResults]
        .sort(
          (
            a,
            b
          ) => {
            if (
              b.adultRate !==
              a.adultRate
            ) {
              return (
                b.adultRate -
                a.adultRate
              );
            }

            return (
              b.newPostRate -
              a.newPostRate
            );
          }
        )
        .map(
          (
            item,
            index
          ) => ({
            rank:
              index + 1,

            query:
              item.query,

            adultRate:
              item.adultRate,

            adultPosts:
              item.adultPosts,

            creatorRate:
              item.creatorRate,

            creatorPosts:
              item.creatorPosts,

            newPostRate:
              item.newPostRate,

            newPosts:
              item.newPosts
          })
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
        "FINAL_QUERY_ROTATION_COMPLETED",

      testLimit:
        TEST_POST_LIMIT,

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

      queriesConfigured:
        SEARCH_QUERIES.length,

      queriesExecuted:
        queryResults.length,

      totalFoundPosts:
        combinedFound,

      totalNewPosts:
        combinedNew,

      totalDuplicatePosts:
        combinedDuplicate,

      overallNewPostRate,

      totalAdultPosts,

      totalCreatorPosts,

      queryResults,

      queryRanking,

      priority:
        priorityResult,

      message:
        finalPostCount >=
        TEST_POST_LIMIT
          ? "3000件テスト上限に到達しました。"
          : "仕上げ用検索が完了しました。"
    });
  } catch (error) {
    console.error(
      "COLLECT TEST FINAL ERROR:",
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