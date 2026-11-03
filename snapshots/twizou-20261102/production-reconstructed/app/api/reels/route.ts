import { isUnavailablePost } from "../../../lib/post-status";
import { unavailableKeys } from "../../../lib/post-status-store";
import { NextRequest, NextResponse } from "next/server";
import { loadInitialRanking } from "../../../lib/initial-ranking";
import { supabaseAdmin } from "../../../lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REEL_TIERS = ["S", "A+", "A", "B+", "B", "C"] as const;
const DEFAULT_LIMIT = 120;
const MAX_LIMIT = 160;
const CANDIDATE_POOL_LIMIT = 1000;

type ReelGroup = "S" | "A" | "B" | "C";

type ReelPost = {
  author_id?: string;
  x_post_id: string;
  author_username: string | null;
  author_name: string | null;
  x_url: string;
  preview_image_url: string | null;
  video_url: string;
  views: number;
  likes: number;
  reposts: number;
  replies: number;
  score: number;
  adult_tier: string;
  created_at: string;
};

const GROUP_WEIGHTS: Record<ReelGroup, number> = {
  S: 35,
  A: 30,
  B: 25,
  C: 10,
};

function tierGroup(tier: unknown): ReelGroup | null {
  if (tier === "S") return "S";
  if (tier === "A+" || tier === "A") return "A";
  if (tier === "B+" || tier === "B") return "B";
  if (tier === "C") return "C";
  return null;
}

function effectiveTier(post: any) {
  return typeof post.manual_tier === "string"
    ? post.manual_tier
    : String(post.adult_tier ?? "");
}

function isPlayableVideoUrl(value: unknown) {
  if (typeof value !== "string" || value.length === 0) return false;

  try {
    const url = new URL(value);
    return url.protocol === "https:" && (
      url.hostname === "video.twimg.com" ||
      url.hostname.endsWith(".video.twimg.com")
    );
  } catch {
    return false;
  }
}

function toReelPost(post: any): ReelPost {
  return {
    author_id: post.author_id == null ? undefined : String(post.author_id),
    x_post_id: String(post.x_post_id),
    author_username: post.author_username ?? null,
    author_name: post.author_name ?? null,
    x_url: String(post.x_url),
    preview_image_url: post.preview_image_url ?? null,
    video_url: String(post.video_url),
    views: Number(post.views) || 0,
    likes: Number(post.likes) || 0,
    reposts: Number(post.reposts) || 0,
    replies: Number(post.replies) || 0,
    score: Number(post.score) || 0,
    adult_tier: effectiveTier(post),
    created_at: String(post.created_at),
  };
}

async function fetchReelCandidatePool() {
  const supabase = supabaseAdmin();
  const { data, error } = await supabase
    .from("posts")
    .select([
      "author_id",
      "x_post_id",
      "author_username",
      "author_name",
      "x_url",
      "preview_image_url",
      "video_url",
      "views",
      "likes",
      "reposts",
      "replies",
      "score",
      "adult_tier",
      "manual_tier",
      "created_at",
    ].join(","))
    .eq("collection_source", "curated")
    .eq("is_visible", true)
    .eq("moderation_blocked", false)
    .eq("review_required", false)
    .eq("content_category", "PASS")
    .not("video_url", "is", null)
    .or(
      `adult_tier.in.(${REEL_TIERS.join(",")}),manual_tier.in.(${REEL_TIERS.join(",")})`
    )
    .or(
      `manual_tier.is.null,manual_tier.in.(${REEL_TIERS.join(",")})`
    )
    .order("created_at", { ascending: false })
    .limit(CANDIDATE_POOL_LIMIT);

  if (error) throw error;
  const blocked = await unavailableKeys();
  return ((data ?? []) as any[]).filter(post => !isUnavailablePost(post, blocked));
}

function hashSeed(value: string) {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function seededRandom(seed: number) {
  let state = seed || 1;

  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function buildWeightedFeed(posts: any[], seed: string, limit: number) {
  const random = seededRandom(hashSeed(seed));
  const groups: Record<ReelGroup, any[]> = {
    S: [],
    A: [],
    B: [],
    C: [],
  };

  for (const post of posts) {
    const group = tierGroup(post.adult_tier);
    if (!group) continue;
    groups[group].push(post);
  }

  for (const group of Object.values(groups)) {
    for (let index = group.length - 1; index > 0; index -= 1) {
      const target = Math.floor(random() * (index + 1));
      [group[index], group[target]] = [group[target], group[index]];
    }
  }

  const result: any[] = [];

  while (result.length < limit) {
    const available = (Object.keys(groups) as ReelGroup[]).filter(
      (group) => groups[group].length > 0
    );

    if (available.length === 0) break;

    const totalWeight = available.reduce(
      (total, group) => total + GROUP_WEIGHTS[group],
      0
    );
    let selection = random() * totalWeight;
    let selectedGroup = available[available.length - 1];

    for (const group of available) {
      selection -= GROUP_WEIGHTS[group];
      if (selection <= 0) {
        selectedGroup = group;
        break;
      }
    }

    const post = groups[selectedGroup].pop();
    if (post) result.push(post);
  }

  return result;
}

export async function GET(request: NextRequest) {
  try {
    const rawLimit = Number(request.nextUrl.searchParams.get("limit"));
    const limit = Number.isFinite(rawLimit)
      ? Math.min(MAX_LIMIT, Math.max(10, Math.floor(rawLimit)))
      : DEFAULT_LIMIT;
    const seed = (
      request.nextUrl.searchParams.get("seed") ||
      `${Date.now()}-${Math.random()}`
    ).slice(0, 100);

    const [candidateRows, trending, daily, weekly] = await Promise.all([
      fetchReelCandidatePool(),
      loadInitialRanking("trending"),
      loadInitialRanking("daily"),
      loadInitialRanking("weekly"),
    ]);
    const currentRankingPosts = [trending, daily, weekly].flat();
    const currentRankingIds = new Set(
      currentRankingPosts.map((post) => post.x_post_id)
    );
    const candidates: ReelPost[] = candidateRows
        .filter((post: any) =>
          REEL_TIERS.includes(effectiveTier(post) as typeof REEL_TIERS[number]) &&
          isPlayableVideoUrl(post.video_url) &&
          typeof post.x_url === "string" &&
          post.x_url.startsWith("https://") &&
          typeof post.x_post_id === "string" &&
          post.x_post_id.length > 0 &&
          !currentRankingIds.has(post.x_post_id)
        )
        .map(toReelPost);
    const outsideRankingFeed = buildWeightedFeed(candidates, seed, limit);
    const rankingFallbackCandidates = currentRankingPosts
      .filter((post, index, posts) =>
        REEL_TIERS.includes(post.adult_tier as typeof REEL_TIERS[number]) &&
        isPlayableVideoUrl(post.video_url) &&
        posts.findIndex((item) => item.x_post_id === post.x_post_id) === index
      )
      .map(toReelPost);
    const fallbackFeed = outsideRankingFeed.length < limit
      ? buildWeightedFeed(
          rankingFallbackCandidates,
          `${seed}-ranking-fallback`,
          limit - outsideRankingFeed.length
        )
      : [];
    const blocked = await unavailableKeys();
    const data = [...outsideRankingFeed, ...fallbackFeed].filter(post => !isUnavailablePost(post, blocked));
    const tierCounts = data.reduce<Record<string, number>>((counts, post) => {
      const tier = String(post.adult_tier);
      counts[tier] = (counts[tier] ?? 0) + 1;
      return counts;
    }, {});

    return NextResponse.json(
      {
        ok: true,
        seed,
        count: data.length,
        candidateCount: candidates.length,
        excludedCurrentRankingCount: currentRankingIds.size,
        rankingFallbackCount: fallbackFeed.length,
        tierCounts,
        data,
      },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0",
          "X-Robots-Tag": "noindex, nofollow, noarchive",
        },
      }
    );
  } catch (error) {
    console.error("REELS API ERROR:", error);

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "リールの取得中にエラーが発生しました。",
      },
      { status: 500 }
    );
  }
}

