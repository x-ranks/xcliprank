import { unstable_cache } from "next/cache";
import { buildLiquidRankings, liquidityClock } from "../../../lib/ranking-liquidity";
import {
  NextRequest,
  NextResponse
} from "next/server";

import {
  supabaseAdmin
} from "../../../lib/supabase-admin";

import {
  classifyContent,
  type ContentCategory
} from "../../../lib/content-filter";

export const runtime = "nodejs";

/*
 * =========================
 * Range
 * =========================
 */

type RangeType =
  | "trending"
  | "daily"
  | "weekly";

function getHours(
  range: RangeType
) {
  if (range === "weekly") {
    return 168;
  }

  if (range === "daily") {
    return 24;
  }

  /*
   * 新着
   */
  return 24;
}

/*
 * =========================
 * Tier
 * =========================
 *
 * 表示優先順位
 *
 * S
 * ↓
 * A+
 * ↓
 * A
 * ↓
 * B
 * ↓
 * C
 *
 * D / X / NONE は
 * ランキング対象外
 */

const DISPLAY_TIERS = [
  "S",
  "A+",
  "A",
  "B+",
  "B",
  "C"
] as const;

const EVERGREEN_TIERS = [
  "S",
  "A+",
  "A"
] as const;

const MANUAL_TIER_SCORE: Record<string, number> = {
  S: 0.95,
  "A+": 0.86,
  A: 0.8,
  "B+": 0.72,
  B: 0.67,
  C: 0.55,
};

function applyManualTierOverride(post: any) {
  const manualTier = typeof post.manual_tier === "string"
    ? post.manual_tier
    : null;
  const tier = manualTier ?? String(post.adult_tier ?? "");

  return {
    ...post,
    automatic_adult_tier: post.adult_tier ?? null,
    adult_tier: tier,
    effective_adult_score:
      manualTier && MANUAL_TIER_SCORE[manualTier] !== undefined
        ? MANUAL_TIER_SCORE[manualTier]
        : post.effective_adult_score,
    manual_tier_applied: manualTier !== null,
  };
}

const CONTENT_CATEGORIES = [
  "PASS",
  "AI_GENERATED",
  "SOFT_GRAVURE",
  "PROMO",
  "OUT_OF_SCOPE",
  "SAFETY_REVIEW"
] as const;

const MAX_RANKING_POSTS = 100;
const TARGET_POSTS_BY_RANGE: Record<RangeType, number> = {
  trending: 100,
  daily: 100,
  weekly: 100,
};
const MAX_CURATED_POSTS = 100;
const MAX_DISCOVERY_POSTS = 0;
const MAX_POSTS_PER_AUTHOR = 20;
const MAX_FALLBACK_POSTS_PER_AUTHOR = 20;
const VISUAL_PREFERENCE_WEIGHT = 0.2;

function isContentCategory(
  value: unknown
): value is ContentCategory {
  return CONTENT_CATEGORIES.includes(
    value as ContentCategory
  );
}

function hasContentFilterFalsePositiveOverride(
  post: any
) {
  return typeof post.manual_review_note ===
    "string" &&
    post.manual_review_note.startsWith(
      "content-filter review; verdict=false_positive"
    );
}

function applyContentFilter(
  posts: any[]
) {
  const categoryCounts:
    Record<ContentCategory, number> = {
      PASS: 0,
      AI_GENERATED: 0,
      SOFT_GRAVURE: 0,
      PROMO: 0,
      OUT_OF_SCOPE: 0,
      SAFETY_REVIEW: 0
    };

  let manualOverrides =
    0;

  const passedPosts =
    posts.filter(
      (post) => {
        let category: ContentCategory;

        if (
          hasContentFilterFalsePositiveOverride(
            post
          )
        ) {
          category = "PASS";
          manualOverrides += 1;
        } else if (
          isContentCategory(
            post.content_category
          )
        ) {
          category = post.content_category;
        } else {
          category =
            classifyContent(
              String(
                post.text ??
                  ""
              )
            ).category;
        }

        categoryCounts[category] +=
          1;

        return category === "PASS";
      }
    );

  return {
    posts: passedPosts,
    candidateCountBeforeContentFilter:
      posts.length,
    contentFilterExcludedCount:
      posts.length -
      passedPosts.length,
    contentFilterCategoryCounts:
      categoryCounts,
    contentFilterManualOverrides:
      manualOverrides
  };
}

/*
 * Tierごとの基礎点
 *
 * Tierの違いを
 * 人気scoreより強く効かせる。
 */
const TIER_WEIGHT:
  Record<string, number> = {
    S: 500,
    "A+": 400,
    A: 300,
    "B+": 250,
    B: 200,
    C: 100
  };

/*
 * =========================
 * 数値変換
 * =========================
 */

function toNumber(
  value: unknown
) {
  const number =
    Number(value);

  return Number.isFinite(
    number
  )
    ? number
    : 0;
}

/*
 * =========================
 * Ranking Value
 * =========================
 *
 * Tier
 * +
 * effective_adult_score
 * +
 * 人気score
 *
 * で最終順位を作る。
 *
 * Tierを最重要視しつつ、
 * 同Tier内では
 *
 * effective_adult_score
 * ↓
 * score
 *
 * が効く。
 */

function calculateRankingValue(
  post: any
) {
  const tier =
    String(
      post.adult_tier ??
        ""
    );

  const tierWeight =
    TIER_WEIGHT[tier] ??
    0;

  const effectiveAdultScore =
    toNumber(
      post.effective_adult_score
    );

  const popularityScore =
    toNumber(
      post.score
    );

  /*
   * effectiveAdultScore
   *
   * 最大約100点
   */
  const adultWeight =
    effectiveAdultScore *
    100;

  /*
   * 人気scoreが巨大でも
   * Tier差を簡単に
   * 逆転させないため圧縮。
   *
   * log10を使う。
   */
  const popularityWeight =
    popularityScore > 0
      ? Math.log10(
          popularityScore + 1
        ) * 10
      : 0;

  return (
    tierWeight +
    adultWeight +
    popularityWeight
  );
}

/*
 * =========================
 * DB取得
 * =========================
 */

async function fetchCandidates(
  since: string | null,
  authorIds?: string[],
  allowedTiers: readonly string[] = DISPLAY_TIERS,
  options: { before?: string; newestFirst?: boolean; poolLimit?: number } = {}
) {
  if (
    authorIds &&
    authorIds.length === 0
  ) {
    return [];
  }

  const supabase =
    supabaseAdmin();

  let query =
    supabase
      .from("posts")
      .select("*")

      /*
       * 表示可能
       */
      .eq(
        "is_visible",
        true
      )

      /*
       * 管理者または教師レビューで
       * 規約違反と判断した投稿は除外
       */
      .eq(
        "moderation_blocked",
        false
      )

      /*
       * 要確認投稿は除外
       */
      .eq(
        "review_required",
        false
      )

      /*
       * 動画URL必須
       */
      .not(
        "video_url",
        "is",
        null
      )

      /*
       * 自動Tierまたは手動Tierがランキング対象の投稿だけ取得する。
       * 手動D/Xは、自動Tierが高くてもランキングから除外する。
       */
      .or(
        `adult_tier.in.(${allowedTiers.join(",")}),manual_tier.in.(${allowedTiers.join(",")})`
      )
      .or(
        `manual_tier.is.null,manual_tier.in.(${allowedTiers.join(",")})`
      )

      /*
       * DB側では候補を
       * 多めに取得
       */
      .order(
        options.newestFirst ? "created_at" : "effective_adult_score",
        {
          ascending: false
        }
      )
      .order(
        "created_at",
        {
          ascending: false
        }
      );

  if (options.newestFirst) {
    query = query.order("created_at", { ascending: false, nullsFirst: false });
  }
  if (options.before) query = query.lt("created_at", options.before);

  if (since) {
    query = query.gte(
      "created_at",
      since
    );
  }

  if (authorIds) {
    query = query.in(
      "author_id",
      authorIds
    );
  }

  const data: any[] = [];
  const poolLimit = options.poolLimit ?? 500;
  for (let offset = 0; offset < poolLimit; offset += 500) {
    const pageSize = Math.min(500, poolLimit - offset);
    const page = await query.range(offset, offset + pageSize - 1);
    if (page.error) throw page.error;
    data.push(...(page.data ?? []));
    if ((page.data?.length ?? 0) < pageSize) break;
  }

  return (data ?? [])
    .map(applyManualTierOverride)
    .filter((post) =>
      allowedTiers.includes(
        String(post.adult_tier ?? "")
      )
    );
}

async function fetchCandidatePool(
  since: string | null,
  curatedAuthorIds: Set<string>,
  allowedTiers: readonly string[] = DISPLAY_TIERS,
  options: { before?: string; newestFirst?: boolean; poolLimit?: number } = {}
) {
  // ランキング候補も選別投稿者だけをDBから取得する。
  return fetchCandidates(
    since,
    [...curatedAuthorIds],
    allowedTiers,
    options
  );
}

async function fetchActiveCuratedAuthorIds() {
  const {
    data,
    error
  } = await supabaseAdmin()
    .from("authors")
    .select("x_author_id")
    .eq("is_curated", true)
    .eq("curated_status", "active");

  if (error) {
    throw error;
  }

  return new Set(
    (data ?? []).map(
      (author) =>
        String(author.x_author_id)
    )
  );
}

/*
 * =========================
 * Sort
 * =========================
 */

function sortPosts(
  posts: any[],
  useVisualPreference = true
) {
  const baseSorted = posts
    .map(
      (post) => ({
        ...post,

        /*
         * デバッグ確認にも使える
         */
        ranking_value:
          Number(
            calculateRankingValue(
              post
            ).toFixed(4)
          )
      })
    )

    .sort(
      (
        a,
        b
      ) => {
        /*
         * =====================
         * 1. Tier
         * =====================
         */

        const tierA =
          TIER_WEIGHT[
            String(
              a.adult_tier ??
                ""
            )
          ] ?? 0;

        const tierB =
          TIER_WEIGHT[
            String(
              b.adult_tier ??
                ""
            )
          ] ?? 0;

        if (
          tierA !== tierB
        ) {
          return (
            tierB -
            tierA
          );
        }

        /*
         * =====================
         * 2. effective adult
         * =====================
         */

        const adultA =
          toNumber(
            a.effective_adult_score
          );

        const adultB =
          toNumber(
            b.effective_adult_score
          );

        if (
          adultA !== adultB
        ) {
          return (
            adultB -
            adultA
          );
        }

        /*
         * =====================
         * 3. 人気score
         * =====================
         */

        return (
          toNumber(
            b.score
          ) -
          toNumber(
            a.score
          )
        );
      }
    );

  if (!useVisualPreference) {
    return baseSorted;
  }

  const tierGroups = new Map<string, any[]>();
  for (const post of baseSorted) {
    const tier = String(post.adult_tier ?? "");
    tierGroups.set(tier, [...(tierGroups.get(tier) ?? []), post]);
  }

  const blended: any[] = [];
  for (const group of tierGroups.values()) {
    const scoredPosts = group.filter((post) =>
      post.visual_preference_score !== null &&
      post.visual_preference_score !== undefined &&
      Number.isFinite(Number(post.visual_preference_score))
    );
    const visualOrder = [...scoredPosts].sort(
      (a, b) => Number(b.visual_preference_score) - Number(a.visual_preference_score)
    );
    const visualRanks = new Map(
      visualOrder.map((post, index) => [
        String(post.x_post_id ?? post.id),
        visualOrder.length <= 1 ? 1 : 1 - index / (visualOrder.length - 1)
      ])
    );

    group.forEach((post, index) => {
      const basePercentile = group.length <= 1 ? 1 : 1 - index / (group.length - 1);
      const visualPercentile = visualRanks.get(String(post.x_post_id ?? post.id));
      const combinedPercentile = visualPercentile == null
        ? basePercentile
        : basePercentile * (1 - VISUAL_PREFERENCE_WEIGHT) +
          visualPercentile * VISUAL_PREFERENCE_WEIGHT;
      blended.push({
        ...post,
        visual_preference_applied: visualPercentile != null,
        visual_preference_percentile: visualPercentile ?? null,
        combined_ranking_percentile: Number(combinedPercentile.toFixed(6))
      });
    });
  }

  return blended.sort((a, b) => {
    const tierDifference =
      (TIER_WEIGHT[String(b.adult_tier ?? "")] ?? 0) -
      (TIER_WEIGHT[String(a.adult_tier ?? "")] ?? 0);
    if (tierDifference !== 0) return tierDifference;
    return b.combined_ranking_percentile - a.combined_ranking_percentile;
  });
}

function sortNewestPosts(
  posts: any[]
) {
  return posts
    .map(
      (post) => ({
        ...post,
        ranking_value:
          Number(
            calculateRankingValue(
              post
            ).toFixed(4)
          ),
        visual_preference_applied: false
      })
    )
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() -
        new Date(a.created_at).getTime()
    );
}

function getAuthorKey(post: any) {
  return String(
    post.author_id ??
      post.author_username ??
      post.id
  );
}

function takeWithAuthorLimit(
  posts: any[],
  limit: number,
  maxPostsPerAuthor = MAX_POSTS_PER_AUTHOR
) {
  const authorCounts =
    new Map<string, number>();
  const selected: any[] = [];

  for (const post of posts) {
    if (selected.length >= limit) {
      break;
    }

    const authorKey =
      getAuthorKey(post);
    const count =
      authorCounts.get(authorKey) ?? 0;

    if (count >= maxPostsPerAuthor) {
      continue;
    }

    selected.push(post);
    authorCounts.set(
      authorKey,
      count + 1
    );
  }

  return selected;
}

function selectRankingMix(
  rankedPosts: any[],
  curatedAuthorIds: Set<string>,
  useVisualPreference: boolean,
  newestFirst = false,
  maxPostsPerAuthor = MAX_POSTS_PER_AUTHOR
) {
  const curatedCandidates =
    rankedPosts.filter((post) =>
      curatedAuthorIds.has(
        String(post.author_id)
      )
    );
  const discoveryCandidates =
    rankedPosts.filter((post) =>
      !curatedAuthorIds.has(
        String(post.author_id)
      )
    );

  const curatedPosts =
    takeWithAuthorLimit(
      curatedCandidates,
      MAX_CURATED_POSTS,
      maxPostsPerAuthor
    );

  /*
   * 広域探索は停止済みのため、
   * 選別投稿者以外はランキングに含めない。
   */
  const discoveryPosts: any[] = [];

  return {
    posts: (
      newestFirst
        ? sortNewestPosts([
            ...curatedPosts,
            ...discoveryPosts
          ])
        : sortPosts([
            ...curatedPosts,
            ...discoveryPosts
          ], useVisualPreference)
    ).slice(0, MAX_RANKING_POSTS),
    curatedCandidateCount:
      curatedCandidates.length,
    discoveryCandidateCount:
      discoveryCandidates.length,
    curatedSelectedCount:
      curatedPosts.length,
    discoverySelectedCount:
      discoveryPosts.length
  };
}

function supplementRankingPosts(
  primaryPosts: any[],
  fallbackPosts: any[],
  curatedAuthorIds: Set<string>,
  targetCount: number,
  maxPostsPerAuthor: number
) {
  const selected = [...primaryPosts];
  const selectedIds = new Set(
    selected.map((post) =>
      String(post.x_post_id ?? post.id)
    )
  );
  const authorCounts = new Map<string, number>();

  for (const post of selected) {
    const authorKey = getAuthorKey(post);
    authorCounts.set(
      authorKey,
      (authorCounts.get(authorKey) ?? 0) + 1
    );
  }

  for (const post of fallbackPosts) {
    if (selected.length >= targetCount) break;

    const postId = String(post.x_post_id ?? post.id);
    if (selectedIds.has(postId)) continue;

    const authorKey = getAuthorKey(post);
    if ((authorCounts.get(authorKey) ?? 0) >= maxPostsPerAuthor) {
      continue;
    }

    const isDiscovery =
      !curatedAuthorIds.has(String(post.author_id));
    if (isDiscovery) continue;

    selected.push({
      ...post,
      ranking_supplemented: true
    });
    selectedIds.add(postId);
    authorCounts.set(
      authorKey,
      (authorCounts.get(authorKey) ?? 0) + 1
    );
  }

  return selected;
}

// Cache the candidate snapshot for both tabs; the bucket key prevents independent draws.
const loadLiquidRankingPlan = unstable_cache(async (snapshot: number, since: string, seed: string) => {
  const authorIds = await fetchActiveCuratedAuthorIds();
  const [recentRaw, archiveRaw] = await Promise.all([
    fetchCandidatePool(since, authorIds, DISPLAY_TIERS, { newestFirst: true, poolLimit: 1000 }),
    fetchCandidatePool(null, authorIds, EVERGREEN_TIERS, { before: since, poolLimit: 3000 })
  ]);
  const eligibleRaw = [...new Map([...recentRaw, ...archiveRaw].map(p => [String(p.x_post_id ?? p.id), p])).values()];
  const filtered = applyContentFilter(eligibleRaw);
  const recent = sortNewestPosts(filtered.posts.filter(p => Date.parse(p.created_at) >= Date.parse(since) && Date.parse(p.created_at) <= snapshot));
  const archive = sortPosts(filtered.posts.filter(p => Date.parse(p.created_at) < Date.parse(since)), true);
  const plan = buildLiquidRankings(recent, archive, since, seed);
  // The unclaimed recent slots in 24h are ranked by the existing quality/popularity method.
  const recentDaily = sortPosts(plan.daily.filter(p => p.ranking_slot === 'recent'), true);
  plan.daily = [...recentDaily, ...plan.daily.filter(p => p.ranking_slot !== 'recent')];
  return { ...plan, filtered, authorCount: authorIds.size };
}, ['liquid-ranking-plan-v1'], { revalidate: 300 });

async function liquidRankingResponse(range: 'trending' | 'daily', visual: boolean) {
  const clock = liquidityClock();
  const plan = await loadLiquidRankingPlan(clock.snapshot, clock.since, clock.seed);
  const data = plan[range];
  const tierCounts = data.reduce<Record<string, number>>((counts, post) => {
    const tier = String(post.adult_tier); counts[tier] = (counts[tier] ?? 0) + 1; return counts;
  }, {});
  return NextResponse.json({
    ok: true, range, count: data.length, targetPostCount: 100,
    fallbackUsed: data.some(p => p.ranking_supplemented), fallbackHoursUsed: null,
    fallbackStrategy: range === 'trending' ? 'daily_random_a_or_higher' : '85_quality_archive_disjoint',
    candidateCount: plan.filtered.posts.length,
    candidateCountBeforeContentFilter: plan.filtered.candidateCountBeforeContentFilter,
    contentFilterExcludedCount: plan.filtered.contentFilterExcludedCount,
    contentFilterCategoryCounts: plan.filtered.contentFilterCategoryCounts,
    contentFilterManualOverrides: plan.filtered.contentFilterManualOverrides,
    rankingMix: { activeCuratedAuthorCount: plan.authorCount, curatedCandidateCount: plan.filtered.posts.length, discoveryCandidateCount: 0, curatedSelectedCount: data.length, discoverySelectedCount: 0, maxPostsPerAuthor: MAX_POSTS_PER_AUTHOR, maxCuratedPosts: range === 'trending' ? 200 : 100, maxDiscoveryPosts: 0 },
    liquidity: { ...plan.metrics, snapshotAt: new Date(clock.snapshot).toISOString(), pastBefore: clock.since },
    tierCounts, tierPriority: DISPLAY_TIERS,
    rankingMethod: range === 'trending' ? 'newest first + daily random A-or-higher archive; disjoint from daily' : '85 quality-ranked archive slots + 15 unclaimed videos; disjoint from trending',
    visualPreference: { enabled: range === 'daily' && visual, weight: range === 'daily' && visual ? VISUAL_PREFERENCE_WEIGHT : 0, scoredCount: data.filter(p => p.visual_preference_applied).length },
    data
  }, { headers: { 'Cache-Control': 'no-store' } });
}

/*
 * =========================
 * GET
 * =========================
 */

export async function GET(
  req: NextRequest
) {
  const rankingSourceUrl =
    process.env.RANKINGS_SOURCE_URL?.trim();

  if (rankingSourceUrl) {
    const sourceUrl = new URL(rankingSourceUrl);
    sourceUrl.search = req.nextUrl.search;

    const sourceResponse = await fetch(sourceUrl, {
      cache: "no-store"
    });
    const sourceBody = await sourceResponse.text();

    return new NextResponse(sourceBody, {
      status: sourceResponse.status,
      headers: {
        "content-type":
          sourceResponse.headers.get("content-type") ??
          "application/json; charset=utf-8"
      }
    });
  }

  try {
    /*
     * =========================
     * Range取得
     * =========================
     */

    const rawRange =
      req.nextUrl
        .searchParams
        .get("range");

    const range:
      RangeType =
      rawRange === "weekly"
        ? "weekly"
        : rawRange ===
          "daily"
        ? "daily"
          : "trending";
    const useVisualPreference =
      req.nextUrl.searchParams.get("visual") !== "0";

    if (range === 'trending' || range === 'daily') {
      return await liquidRankingResponse(range, useVisualPreference);
    }

    const hours =
      getHours(range);

    /*
     * =========================
     * 通常期間
     * =========================
     */

    const since =
      new Date(
        Date.now() -
          hours *
            60 *
            60 *
            1000
      ).toISOString();

    /*
     * =========================
     * Candidate取得
     * =========================
     */

    const curatedAuthorIds =
      await fetchActiveCuratedAuthorIds();

    let posts =
      await fetchCandidatePool(
        since,
        curatedAuthorIds
      );

    /*
     * =========================
     * Ranking
     * =========================
     */

    const newestFirst = false;
    const targetPostCount =
      TARGET_POSTS_BY_RANGE[range];

    const prepareRanking =
      (
        candidatePosts: any[],
        maxPostsPerAuthor = MAX_POSTS_PER_AUTHOR,
        forceTierPriority = false
      ) => {
        const filtered =
          applyContentFilter(
            candidatePosts
          );
        const ranked =
          newestFirst && !forceTierPriority
            ? sortNewestPosts(
                filtered.posts
              )
            : sortPosts(
                filtered.posts,
                false
              );
        const mix =
          selectRankingMix(
            ranked,
            curatedAuthorIds,
            useVisualPreference,
            newestFirst && !forceTierPriority,
            maxPostsPerAuthor
          );

        return {
          contentFiltered: filtered,
          rankingMix: mix,
          rankedPosts: ranked
        };
      };

    let prepared =
      prepareRanking(posts);
    let fallbackUsed = false;
    let fallbackHoursUsed: number | null = null;

    /*
     * 各ランキングが目標件数に満たない場合は、
     * 期間制限なしのS〜A動画をTier優先で補う。
     * 補充枠も1投稿者最大20件まで許可する。
     */
    if (
      prepared.rankingMix.posts.length < targetPostCount
    ) {
      const fallbackPosts =
        await fetchCandidatePool(
          null,
          curatedAuthorIds,
          EVERGREEN_TIERS
        );
      const fallbackPrepared =
        prepareRanking(
          fallbackPosts,
          MAX_FALLBACK_POSTS_PER_AUTHOR,
          true
        );
      const primaryCount =
        prepared.rankingMix.posts.length;
      const supplementedPosts =
        supplementRankingPosts(
          prepared.rankingMix.posts,
          fallbackPrepared.rankingMix.posts,
          curatedAuthorIds,
          targetPostCount,
          MAX_FALLBACK_POSTS_PER_AUTHOR
        );

      prepared = {
        ...fallbackPrepared,
        rankingMix: {
          ...fallbackPrepared.rankingMix,
          posts: supplementedPosts,
          curatedSelectedCount: supplementedPosts.length,
          discoverySelectedCount: 0
        }
      };
      fallbackUsed = supplementedPosts.length > primaryCount;
    }

    const contentFiltered =
      prepared.contentFiltered;
    const rankingMix =
      prepared.rankingMix;
    const finalPosts =
      rankingMix.posts;

    /*
     * =========================
     * Tier件数
     * =========================
     */

    const tierCounts =
      finalPosts.reduce<
        Record<
          string,
          number
        >
      >(
        (
          counts,
          post
        ) => {
          const tier =
            String(
              post.adult_tier ??
                "UNKNOWN"
            );

          counts[tier] =
            (
              counts[tier] ??
              0
            ) + 1;

          return counts;
        },
        {}
      );

    /*
     * =========================
     * Response
     * =========================
     */

    return NextResponse.json({
      ok: true,

      range,

      fallbackUsed,

      fallbackHoursUsed,

      fallbackStrategy:
        fallbackUsed ? "evergreen_s_to_a" : null,

      targetPostCount,

      /*
       * DBから取得した候補数
       */
      candidateCount:
        contentFiltered.posts.length,

      candidateCountBeforeContentFilter:
        contentFiltered.candidateCountBeforeContentFilter,

      contentFilterExcludedCount:
        contentFiltered.contentFilterExcludedCount,

      contentFilterCategoryCounts:
        contentFiltered.contentFilterCategoryCounts,

      contentFilterManualOverrides:
        contentFiltered.contentFilterManualOverrides,

      /*
       * 実際の返却数
       */
      count:
        finalPosts.length,

      rankingMix: {
        activeCuratedAuthorCount:
          curatedAuthorIds.size,
        curatedCandidateCount:
          rankingMix.curatedCandidateCount,
        discoveryCandidateCount:
          rankingMix.discoveryCandidateCount,
        curatedSelectedCount:
          rankingMix.curatedSelectedCount,
        discoverySelectedCount:
          rankingMix.discoverySelectedCount,
        maxPostsPerAuthor:
          MAX_POSTS_PER_AUTHOR,
        maxCuratedPosts:
          MAX_CURATED_POSTS,
        maxDiscoveryPosts:
          MAX_DISCOVERY_POSTS
      },

      /*
       * 上位100件の
       * Tier分布
       */
      tierCounts,

      tierPriority: [
        "S",
        "A+",
        "A",
        "B+",
        "B",
        "C"
      ],

      rankingMethod:
        newestFirst
          ? "newest first; curated only; max 20 per author"
          : useVisualPreference
          ? "tier > same-tier base 80% + visual preference 20%; curated only; max 20 per author"
          : "tier > effective_adult_score > popularity_score; curated only; max 20 per author",

      visualPreference: {
        enabled: useVisualPreference && !newestFirst,
        weight: useVisualPreference && !newestFirst ? VISUAL_PREFERENCE_WEIGHT : 0,
        scoredCount: finalPosts.filter((post) => post.visual_preference_applied).length
      },

      data:
        finalPosts
    });
  } catch (error) {
    console.error(
      "RANKINGS ERROR:",
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

