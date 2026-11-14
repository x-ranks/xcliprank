import { createRankingReadCache } from "../../../lib/ranking-read-cache";
import { readCuratedReferences, eligibleCuratedReferences, referencePermitsPost } from "../../../lib/curated-video-references";
import { rememberRanking } from "../../../lib/public-ranking-history";
import { createRankHistoryStore } from "../../../lib/rank-history-store";
import { applyManualPlacements, readManualState, type ManualPlacement } from "../../../lib/manual-ranking";
import { eligibleManualXIds } from "../../../lib/manual-x-permissions";
import { createPublicCatalog } from "../../../lib/public-catalog-store";
import { publicCatalogDirectory } from "../../../lib/public-save-secret";
import { readRankingUpdate } from "../../../lib/ranking-update";
import { isUnavailablePost } from "../../../lib/post-status";
import { unavailableKeys } from "../../../lib/post-status-store";
import { buildLiquidRankings, liquidityClock } from "../../../lib/ranking-liquidity";
import { buildNewestFeed, videoIdentity, NEWEST_TOTAL, NEWEST_PAGE_SIZE, NEWEST_AUTHOR_LIMIT } from "../../../lib/newest-feed";
import { readScheduledFreeState } from "../../../lib/free-curated-server-store";
import { editionId, editionEntry, readEdition, saveEdition, editionCacheRevision, validateEditionId, type RankingEdition } from "../../../lib/ranking-editions";
import { parseRankingPage, newestPageHref } from "../../../lib/ranking-pagination";
import {
  after,
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

// Off-page rows still participate in current safety checks and page counts.
// Metrics, images and model payloads are only needed in the displayed window.
const ELIGIBILITY_FIELDS = "id,x_post_id,author_id,author_username,video_url,adult_tier,manual_tier,text,content_category,manual_review_note";
type CandidateOptions = { before?: string; newestFirst?: boolean; poolLimit?: number; ids?: string[]; summaryIds?: ReadonlySet<string> };

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
  options: CandidateOptions = {}
) {
  // Keep PostgREST URLs bounded: 500 long X IDs plus author IDs can exceed proxy limits.
  if (options.ids?.length === 0) return [];
  if (options.ids && options.ids.length > 100) {
    const rows: any[] = [];
    // Three bounded ID queries at a time; preserve the original result order.
    for (let start = 0; start < options.ids.length; start += 300) {
      const groups = [0, 100, 200].map(offset => options.ids!.slice(start + offset, start + offset + 100)).filter(ids => ids.length);
      rows.push(...(await Promise.all(groups.map(ids => fetchCandidates(since, authorIds, allowedTiers, {
        ...options, ids, poolLimit: 100
      })))).flat());
    }
    return rows;
  }
  if (
    authorIds &&
    authorIds.length === 0
  ) {
    return [];
  }

  const supabase =
    supabaseAdmin();

  function pageQuery() {
  let query =
    supabase
      .from("posts")
      .select(options.ids?.every(id => options.summaryIds?.has(id)) ? ELIGIBILITY_FIELDS : "*")

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
    query = query.order("x_post_id", { ascending: false });
  }
  if (options.before) query = query.lt("created_at", options.before);
  if (options.ids) query = query.in("x_post_id", options.ids);

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

    return query;
  }
  const data: any[] = [];
  const poolLimit = options.poolLimit ?? 500;
  // Separate builders are required: PostgREST .range() mutates its builder.
  // Cold edition scans use at most three 500-row pages concurrently.
  for (let start = 0; start < poolLimit; start += 1500) {
    const offsets = [0, 500, 1000].map(offset => start + offset).filter(offset => offset < poolLimit);
    const pages = await Promise.all(offsets.map(offset => pageQuery().range(offset, Math.min(poolLimit, offset + 500) - 1)));
    for (const page of pages) if (page.error) throw page.error;
    let complete = false;
    for (let i = 0; i < pages.length; i++) {
      const pageSize = Math.min(500, poolLimit - offsets[i]);
      data.push(...(pages[i].data ?? []));
      if ((pages[i].data?.length ?? 0) < pageSize) { complete = true; break; }
    }
    if (complete) break;
  }

  const blocked = await unavailableKeys();
  return (data ?? []).filter(post => !isUnavailablePost(post, blocked))
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
  options: CandidateOptions = {}
) {
  const db=supabaseAdmin();
  // Eligibility is checked on every request; ID batches are bounded and concurrent.
  const ownPromise=fetchCandidates(since,[...curatedAuthorIds],allowedTiers,options);
  const own=await ownPromise;
  // An owned, currently eligible row needs no reference permission. Only missing
  // IDs can require source/selected-author reference checks during hydration.
  const ownIds=new Set(own.map(row=>String(row.x_post_id)));
  const referenceIds=options.ids?.filter(id=>!ownIds.has(id));
  const refs=await eligibleCuratedReferences(db,await readCuratedReferences(db,referenceIds,[...curatedAuthorIds]));
  const ids=[...new Set(refs.filter(r=>curatedAuthorIds.has(r.selected_author_id)).map(r=>r.post_id))]
    .sort((a,b)=>BigInt(a)>BigInt(b)?-1:BigInt(a)<BigInt(b)?1:0).slice(0,options.poolLimit??500);
  const linked=ids.length?await fetchCandidates(since,undefined,allowedTiers,{...options,ids,poolLimit:ids.length}):[];
  const manualEntries = options.ids?.length ? (await readManualState()).entries : [];
  const manualIds = [...new Set(manualEntries.flatMap(entry => entry.xApproval && options.ids?.includes(entry.xApproval.postId) ? [entry.xApproval.postId] : []))];
  const manualRows = manualIds.length ? await fetchCandidates(since,undefined,allowedTiers,{...options,ids:manualIds,poolLimit:manualIds.length,summaryIds:undefined}) : [];
  const permitted = manualRows.length ? await eligibleManualXIds(manualRows,await unavailableKeys()) : new Set<string>();
  return [...new Map([...own,...linked.filter(row=>referencePermitsPost(row,refs)),...manualRows.filter(row=>permitted.has(String(row.x_post_id)))].map(row=>[String(row.x_post_id),row])).values()];
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

async function createWeeklySelection(posts: any[], curatedAuthorIds: Set<string>, useVisualPreference: boolean, fallback: () => Promise<any[]>) {
    const newestFirst = false;
    const targetPostCount =
      TARGET_POSTS_BY_RANGE.weekly;

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
        await fallback();
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
    const blocked = await unavailableKeys();
    const finalPosts = rankingMix.posts.filter(post => !isUnavailablePost(post, blocked));

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

    return {
      ok: true,

      range: "weekly",

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
    };
}

async function createRankingEdition(snapshot: number, blocked: Set<string>) {
  const clock = liquidityClock(snapshot);
  const authorIds = await fetchActiveCuratedAuthorIds();
  const [recentRaw, archiveRaw, weeklyRaw] = await Promise.all([
    fetchCandidatePool(clock.since, authorIds, DISPLAY_TIERS, { newestFirst: true, poolLimit: 1000 }),
    fetchCandidatePool(null, authorIds, EVERGREEN_TIERS, { before: clock.since, newestFirst: true, poolLimit: 3000 }),
    fetchCandidatePool(new Date(snapshot - 7 * 86400000).toISOString(), authorIds)
  ]);
  const registrationState = await readScheduledFreeState();
  const activitySince = snapshot - 24 * 60 * 60 * 1000;
  const registrationTimes = new Map((registrationState.recentRegistrations ?? [])
    .filter(row => row.at >= activitySince && row.at <= snapshot).map(row => [row.id, row.at]));
  const patrolTimes = new Map((registrationState.recentPatrolPosts ?? [])
    .filter(row => row.at >= activitySince && row.at <= snapshot).map(row => [row.id, row.at]));
  const fetchedIds = new Set([...recentRaw, ...archiveRaw].map(post => String(post.x_post_id ?? post.id)));
  const activityIds = [...new Set([...registrationTimes.keys(), ...patrolTimes.keys()])].filter(id => !fetchedIds.has(id));
  const activityRaw: any[] = [];
  for (let start = 0; start < activityIds.length; start += 100) {
    const batch = activityIds.slice(start, start + 100);
    activityRaw.push(...await fetchCandidatePool(null, authorIds, DISPLAY_TIERS, { ids: batch, poolLimit: batch.length }));
  }
  const eligibleRaw = [...new Map([...recentRaw, ...archiveRaw, ...activityRaw].map(p => [String(p.x_post_id ?? p.id), p])).values()];
  const filtered = applyContentFilter(eligibleRaw);
  const recent = sortNewestPosts(filtered.posts.filter(p => Date.parse(p.created_at) >= Date.parse(clock.since) && Date.parse(p.created_at) <= snapshot));
  const archive = filtered.posts.filter(p => Date.parse(p.created_at) < Date.parse(clock.since));
  const tierPriority: Record<string, number> = { S: 0, "A+": 1, A: 2 };
  const protectedIds = new Set<string>(), protectedMedia = new Set<string>(), protectedAuthors = new Map<string, number>();
  const registrationCandidates = filtered.posts.filter(post => registrationTimes.has(String(post.x_post_id)) &&
    Object.prototype.hasOwnProperty.call(tierPriority, String(post.adult_tier)))
    .sort((a, b) => tierPriority[String(a.adult_tier)] - tierPriority[String(b.adult_tier)] ||
      (registrationTimes.get(String(b.x_post_id)) ?? 0) - (registrationTimes.get(String(a.x_post_id)) ?? 0) ||
      Date.parse(b.created_at) - Date.parse(a.created_at));
  for (const post of registrationCandidates) {
    if (protectedIds.size >= 5) break;
    const author = String(post.author_id), media = videoIdentity(post);
    if ((protectedAuthors.get(author) ?? 0) >= 3 || media && protectedMedia.has(media)) continue;
    protectedIds.add(String(post.x_post_id)); if (media) protectedMedia.add(media);
    protectedAuthors.set(author, (protectedAuthors.get(author) ?? 0) + 1);
  }
  const availableElsewhere = (post: any) => !protectedIds.has(String(post.x_post_id ?? post.id)) &&
    (!videoIdentity(post) || !protectedMedia.has(videoIdentity(post)!));
  let fallbackPromise: Promise<any[]> | undefined;
  const fallback = () => fallbackPromise ??= fetchCandidatePool(null, authorIds, EVERGREEN_TIERS).then(rows => rows.filter(availableElsewhere));
  const weeklyCandidates = weeklyRaw.filter(availableElsewhere);
  const [weekly, weeklyBase] = await Promise.all([
    createWeeklySelection(weeklyCandidates, authorIds, true, fallback),
    createWeeklySelection(weeklyCandidates, authorIds, false, fallback)
  ]);
  // Preserve the current daily 85 archive slots, recent slots and seeded display selection.
  const dailyPlan = buildLiquidRankings(recent.filter(availableElsewhere), archive.filter(availableElsewhere), clock.since, clock.seed);
  const reservedRows = [...dailyPlan.daily, ...weekly.data, ...weeklyBase.data];
  const reserved = new Set(reservedRows.map(p => String(p.x_post_id ?? p.id)));
  const reservedMedia = new Set(reservedRows.map(videoIdentity).filter((key): key is string => key !== null));
  const newest = buildNewestFeed(recent, archive, reserved, clock.seed, reservedMedia, registrationTimes, patrolTimes);
  const { posts: _posts, ...filterMetrics } = filtered;
  const { data: _weekly, ...weeklyMeta } = weekly;
  const { data: _weeklyBase, ...weeklyBaseMeta } = weeklyBase;
  return {
    version: 1 as const, edition: editionId(snapshot, blocked), snapshot,
    plans: {
      trending: newest.posts.map(editionEntry), daily: dailyPlan.daily.map(editionEntry),
      weekly: weekly.data.map(editionEntry), weeklyBase: weeklyBase.data.map(editionEntry)
    },
    metadata: {
      authorCount: authorIds.size, filtered: { ...filterMetrics, candidateCount: filtered.posts.length },
      weekly: weeklyMeta, weeklyBase: weeklyBaseMeta,
      liquidity: { ...dailyPlan.metrics, newRecent: newest.newRecent, newArchive: newest.newArchive,
        newRegistrationPriority: newest.priorityCount,
        newArchiveTarget: NEWEST_TOTAL - newest.newRecent, trendingShortfall: newest.shortfall,
        newArchiveShortfall: newest.shortfall, overlap: 0, weeklyOverlap: 0 },
      since: clock.since, generatedAt: new Date().toISOString()
    }
  };
}

const rankingEditions = new Map<string, Promise<RankingEdition>>();
async function loadRankingEdition(requested: string | null) {
  const clock = liquidityClock(), blocked = await unavailableKeys();
  const edition = requested ?? editionId(clock.snapshot, blocked);
  validateEditionId(edition);
  // The previous five-minute order remains usable briefly while the new order
  // is prepared after the response. Every displayed row is still rechecked below.
  // Explicit historical URLs never silently switch editions.
  if (!requested && Date.now() - clock.snapshot < 60000) {
    const ready = await readEdition(edition);
    if (ready) return ready;
    const previous = await readEdition(editionId(clock.snapshot - 300000, blocked));
    if (previous) {
      try { after(async () => { try { await prepareCurrentEdition(edition, clock.snapshot, blocked); } catch { console.warn("RANKING_PREPARATION_FAILED"); } }); }
      catch { /* No background lifetime outside a Next request. */ }
      return previous;
    }
  }
  return prepareCurrentEdition(edition, clock.snapshot, blocked, Boolean(requested));
}
async function prepareCurrentEdition(edition: string, snapshot: number, blocked: Set<string>, historical = false) {
  let promise = rankingEditions.get(edition);
  if (!promise) {
    promise = (async () => {
      const saved = await readEdition(edition);
      if (saved) return saved;
      // Historical URLs never reconstruct or replace their order from a changed database.
      if (historical) throw Error("RANKING_EDITION_EXPIRED");
      return saveEdition(await createRankingEdition(snapshot, blocked));
    })().catch(error => { rankingEditions.delete(edition); throw error; });
    rankingEditions.set(edition, promise);
    while (rankingEditions.size > 4) rankingEditions.delete(rankingEditions.keys().next().value!);
  }
  return promise;
}

async function editionRankingResponse(req: NextRequest, range: RangeType, visual: boolean) {
  const pageValue = req.nextUrl.searchParams.get("page");
  const page = parseRankingPage(pageValue);
  if (range !== "trending" && pageValue != null) throw Error("INVALID_RANKING_PAGE");
  const requestStarted = performance.now();
  const plan = await loadRankingEdition(req.nextUrl.searchParams.get("edition"));
  const editionFinished = performance.now();
  const key = range === "weekly" && !visual ? "weeklyBase" : range;
  const entries = plan.plans[key];
  const currentEdition = editionId(liquidityClock().snapshot, await unavailableKeys());
  // Hydrate only the requested ranking; reevaluate current DB safety and active author state.
  const [authorIds, manualState] = await Promise.all([
    fetchActiveCuratedAuthorIds(),
    plan.edition === currentEdition || !req.nextUrl.searchParams.get("edition") ? readManualState() : Promise.resolve({ entries: [] })
  ]);
  const manual = manualState.entries.filter(row => row.positions[range] !== null);
  // Keep every frozen slot and its fresh permissions. Without manual placements,
  // only the requested 100-ID batch needs full display fields (50 visible rows).
  const summaryIds = range === "trending" && pageValue != null && manual.length === 0
    ? new Set(entries.filter((_, index) => index < (page - 1) * NEWEST_PAGE_SIZE || index >= page * NEWEST_PAGE_SIZE).map(entry => entry.id))
    : undefined;
  const rows = entries.length ? await fetchCandidatePool(null, authorIds, DISPLAY_TIERS, { ids: entries.map(p => p.id), poolLimit: 500, summaryIds }) : [];
  const filtered = applyContentFilter(rows);
  const byId = new Map(filtered.posts.map(p => [String(p.x_post_id ?? p.id), p]));
  const blocked = await unavailableKeys();
  const hydrated = entries.map((entry, index) => {
    const row = byId.get(entry.id);
    if (!row || isUnavailablePost(row, blocked)) return null;
    if (range === "daily" && !EVERGREEN_TIERS.includes(String(row.adult_tier) as typeof EVERGREEN_TIERS[number])) return null;
    // An archive item cannot survive a later manual downgrade below A.
    if (entry.ranking_supplemented && !EVERGREEN_TIERS.includes(String(row.adult_tier) as typeof EVERGREEN_TIERS[number])) return null;
    const { id: _id, ...decoration } = entry;
    return { ...row, ...decoration, ranking_position: index + 1 };
  });
  const safeData = hydrated.filter((p): p is NonNullable<typeof p> => p !== null);
  const manualXIds = manual.map(row => row.url.match(/(?:x\.com|twitter\.com)\/[^/]+\/status\/(\d+)/)?.[1]).filter((id): id is string => !!id);
  const extraRows = manualXIds.length ? await fetchCandidatePool(null, authorIds, DISPLAY_TIERS, { ids: manualXIds, poolLimit: 100 }) : [];
  const extra = applyContentFilter(extraRows).posts.filter(row => !isUnavailablePost(row, blocked));
  const originalIds = new Set(safeData.map(row => String(row.x_post_id)));
  const eligibleXIds = new Set([...safeData, ...extra].map(row => String(row.x_post_id)));
  const placements = manual.filter(row => { const id = row.url.match(/(?:x\.com|twitter\.com)\/[^/]+\/status\/(\d+)/)?.[1]; return !id || eligibleXIds.has(id); });
  const candidates = [...safeData, ...extra.filter(row => !originalIds.has(String(row.x_post_id)))];
  const allData = (placements.length ? applyManualPlacements(candidates, placements, range, range === "trending" ? NEWEST_TOTAL : 100, blocked) : safeData).map(post => {
    if (!("mediaUrl" in post)) return post;
    const row = post as ManualPlacement & { x_post_id: string; ranking_position: number };
    return { x_post_id: row.x_post_id, manual_id: row.id, manual_media_url: row.mediaUrl,
      manual_title: row.title, x_url: row.url, preview_image_url: row.posterUrl,
      video_url: row.mediaUrl, video_bitrate: null, author_username: null, author_name: row.title,
      views: 0, likes: 0, bookmarks: null, reposts: 0, replies: 0, score: 0, adult_tier: null,
      created_at: row.updatedAt, ranking_position: row.ranking_position };
  });
  const totalPages = Math.max(1, Math.ceil(allData.length / NEWEST_PAGE_SIZE));
  if (range === "trending" && page > totalPages) throw Error("RANKING_PAGE_NOT_FOUND");
  const paginated = range === "trending" && pageValue != null;
  const data = paginated ? (placements.length ? allData : hydrated).slice((page - 1) * NEWEST_PAGE_SIZE, page * NEWEST_PAGE_SIZE).filter((p): p is NonNullable<typeof p> => p !== null) : allData;
  const tierCounts = data.reduce<Record<string, number>>((counts, post) => {
    const tier = String(post.adult_tier); counts[tier] = (counts[tier] ?? 0) + 1; return counts;
  }, {});
  const timing = readRankingUpdate({ rankingUpdatedAt: plan.metadata.generatedAt, rankingSnapshotAt: new Date(plan.snapshot).toISOString() });
  const common = { ok: true, range, rankingUpdatedAt: timing.updatedAt, rankingSnapshotAt: timing.snapshotAt, edition: plan.edition, count: data.length, totalCount: allData.length,
    targetPostCount: range === "trending" ? NEWEST_TOTAL : 100, tierCounts, data };
  const pagination = range === "trending" ? {
    page, pageSize: NEWEST_PAGE_SIZE, totalPosts: allData.length, totalPages, edition: plan.edition,
    previousHref: page > 1 ? newestPageHref(page - 1, plan.edition) : null,
    nextHref: page < totalPages ? newestPageHref(page + 1, plan.edition) : null
  } : undefined;
  const responseHeaders = { "Cache-Control": "no-store", "Server-Timing": `edition;dur=${(editionFinished-requestStarted).toFixed(1)}, hydrate;dur=${(performance.now()-editionFinished).toFixed(1)}` };
  if (range === "weekly") {
    const meta = plan.metadata[key];
    return NextResponse.json({ ...meta, ...common,
      rankingMix: { ...meta.rankingMix, curatedSelectedCount: allData.length },
      visualPreference: { ...meta.visualPreference, scoredCount: allData.filter(p => p.visual_preference_applied).length }
    }, { headers: responseHeaders });
  }
  const metrics = plan.metadata.filtered;
  return NextResponse.json({
    ...metrics, ...common, pagination,
    fallbackUsed: allData.some(p => p.ranking_supplemented), fallbackHoursUsed: null,
    fallbackStrategy: range === "trending" ? "recent_then_a_or_higher_archive_disjoint_daily_weekly" : "85_random_archive_disjoint",
    rankingMix: { activeCuratedAuthorCount: authorIds.size, curatedCandidateCount: metrics.candidateCount,
      discoveryCandidateCount: 0, curatedSelectedCount: allData.length, discoverySelectedCount: 0,
      maxPostsPerAuthor: range === "trending" ? NEWEST_AUTHOR_LIMIT : MAX_POSTS_PER_AUTHOR,
      maxCuratedPosts: range === "trending" ? NEWEST_TOTAL : 100, maxDiscoveryPosts: 0 },
    liquidity: { ...plan.metadata.liquidity, snapshotAt: new Date(plan.snapshot).toISOString(), pastBefore: plan.metadata.since,
      currentVisibleRecent: allData.filter(p => !p.ranking_supplemented).length,
      currentVisibleArchive: allData.filter(p => p.ranking_supplemented).length,
      currentShortfall: Math.max(0, (range === "trending" ? NEWEST_TOTAL : 100) - allData.length) },
    tierPriority: DISPLAY_TIERS,
    rankingMethod: range === "trending" ? "five high-tier fresh registrations; then newly collected posts; then post time; max three per author per page; one high-tier older post per page; disjoint from daily and weekly" : "daily random A-or-higher selection and display; score independent",
    displayOrder: range === "daily" ? "daily_seeded_random" : "recent_pages_author_spread",
    visualPreference: { enabled: false, weight: 0, scoredCount: 0 }
  }, { headers: responseHeaders });
}


/*
 * =========================
 * GET
 * =========================
 */

async function rankingResponse(
  req: NextRequest
) {
  if (req.nextUrl.searchParams.get("range") === "author-status") {
    try { return NextResponse.json({ ok: true, blockedKeys: [...await unavailableKeys()] }, { headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" } }); }
    catch { return NextResponse.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
  }
  const rankingSourceUrl =
    process.env.RANKINGS_SOURCE_URL?.trim();

  if (rankingSourceUrl) {
    const sourceUrl = new URL(rankingSourceUrl);
    sourceUrl.search = req.nextUrl.search;

    const sourceResponse = await fetch(sourceUrl, {
      cache: "no-store"
    });
    let sourceBody = await sourceResponse.text();
    if (sourceResponse.ok) {
      const body = JSON.parse(sourceBody), blocked = await unavailableKeys();
      if (Array.isArray(body.data)) { body.data = body.data.filter((p: any) => !isUnavailablePost(p, blocked)); body.count = body.data.length; }
      sourceBody = JSON.stringify(body);
    }

    return new NextResponse(sourceBody, {
      status: sourceResponse.status,
      headers: {
        "Cache-Control": "no-store",
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

    return await editionRankingResponse(req, range, useVisualPreference);
  } catch (error) {
    const code = error instanceof Error ? error.message : "RANKING_LOAD_FAILED";
    const status = code === "INVALID_RANKING_PAGE" || code === "INVALID_RANKING_EDITION" ? 400
      : code === "RANKING_PAGE_NOT_FOUND" ? 404
      : code === "RANKING_EDITION_EXPIRED" ? 410 : 503;
    console.error("RANKINGS ERROR:", status === 503 ? "RANKING_LOAD_FAILED" : code);

    return NextResponse.json(
      {
        ok: false,

        error: status === 503 ? "RANKING_LOAD_FAILED" : code
      },
      {
        status
      }
    );
  }
}


let rankHistoryStore: ReturnType<typeof createRankHistoryStore> | undefined;
async function uncachedRanking(req: NextRequest) {
  const started = performance.now();
  const response = await rankingResponse(req), historyStarted = performance.now();
  const query = req.nextUrl.searchParams, current = !query.get("edition") && !query.get("page") && !query.has("visual");
  const result = await rememberRanking(response, (ids, at) => createPublicCatalog(publicCatalogDirectory()).ranked(ids, at),
    current ? (range, ids, at) => (rankHistoryStore ??= createRankHistoryStore(publicCatalogDirectory())).record(range, ids, at) : null);
  result.headers.append("Server-Timing", `history;dur=${(performance.now()-historyStarted).toFixed(1)}, ranking;dur=${(performance.now()-started).toFixed(1)}`);
  return result;
}

let publicReadCache: ReturnType<typeof createRankingReadCache> | undefined;
const siblingWarmups = new Set<string>();
export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams;
  // Public ranking data only. Unknown queries, proxy mode, auth and status checks
  // never enter this cache. HTML/RSC and management responses retain their policy.
  const eligible = process.env.NODE_ENV === "production" && process.env.XCLIP_RANKING_CACHE_DISABLED !== "1" &&
    !process.env.RANKINGS_SOURCE_URL?.trim() && !req.headers.has("authorization") &&
    ["trending", "daily", "weekly"].includes(query.get("range") ?? "trending") &&
    [...query.keys()].every(key => ["range", "page", "edition", "visual"].includes(key) && query.getAll(key).length === 1);
  if (!eligible) return uncachedRanking(req);
  try {
    const [blocked, manual] = await Promise.all([unavailableKeys(), readManualState()]);
    const current = editionId(liquidityClock().snapshot, blocked);
    // Files are reread on every cache lookup. DB-only changes have a maximum
    // 30-second reuse window; playback/detail routes still check current access.
    const preparedRevision = await editionCacheRevision(current);
    const key = JSON.stringify([preparedRevision, query.get("range") ?? "trending", query.get("page"), query.get("edition") ?? current,
      query.get("visual") === "0", current, [...blocked].sort(), manual.revision, manual.entries]);
    const started = performance.now();
    const result = await (publicReadCache ??= createRankingReadCache()).get(key, () => uncachedRanking(req));
    result.headers.append("Server-Timing", `cache-lookup;dur=${(performance.now()-started).toFixed(1)}`);
    if (result.ok && result.headers.get("X-Twizou-Ranking-Cache") === "HIT" && Number(result.headers.get("X-Twizou-Ranking-Cache-Age-Ms")) >= 15000) {
      // Refresh before expiry while serving only still-valid data. Expired data
      // is never served, even when the background refresh fails or runs slowly.
      try { after(async () => { try { await publicReadCache!.refresh(key, () => uncachedRanking(req)); } catch { /* Retry on later demand. */ } }); }
      catch { /* No background lifetime outside a Next request. */ }
    }
    if (result.ok && result.headers.get("X-Twizou-Ranking-Cache") === "MISS" && (!query.get("edition") || query.get("edition") === current)) {
      const bucket = current + ":" + Math.floor(Date.now() / 30000);
      if (!siblingWarmups.has(bucket)) {
        siblingWarmups.add(bucket);
        while (siblingWarmups.size > 2) siblingWarmups.delete(siblingWarmups.values().next().value!);
        // Warm two sibling data results after this response, serially. No HTML,
        // media or providers are fetched. Foreground requests share the same flight.
        try { after(async () => {
          for (const range of ["trending", "daily", "weekly"]) {
            if (range === (query.get("range") ?? "trending")) continue;
            try { await GET(new NextRequest("http://internal.local/api/rankings?range=" + range + (range === "trending" ? "&page=1" : ""))); } catch { /* A failed warmup never affects browsing. */ }
          }
        }); } catch { /* CLI/unit contexts have no request lifetime. */ }
      }
    }
    return result;
  } catch {
    return NextResponse.json({ ok: false, error: "RANKING_LOAD_FAILED" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
