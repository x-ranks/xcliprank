import { productionPublicBackend } from "./public-video-production";
import "server-only";
import { supabaseAdmin } from "./supabase-admin";
import { loadRankingPage } from "./initial-ranking";
import { createPublicCatalog } from "./public-catalog-store";
import { publicCatalogDirectory } from "./public-save-secret";
import { publicPostId } from "./public-video-core";
import { rankRising } from "./rising-score";
import { fourHourSnapshot } from "./rising-snapshot";
import type { RankPost } from "../app/components/RankingClient";

const WINDOW_DAYS = 7;
const PAGE_SIZE = 1000;
type RisingPost = RankPost & { siteOpens: number; siteSaves: number; risingScore: number };

async function rankingCandidates() {
  const [newest, daily, weekly] = await Promise.all([
    loadRankingPage("trending", 1), loadRankingPage("daily"), loadRankingPage("weekly")
  ]);
  if ([newest, daily, weekly].some(result => result.status !== 200)) throw Error("RISING_RANKING_UNAVAILABLE");
  const pages = Math.min(10, newest.pagination?.totalPages ?? 1);
  const all = [...newest.posts, ...daily.posts, ...weekly.posts];
  for (let page = 2; page <= pages; page += 3) {
    const batch = await Promise.all(Array.from({ length: Math.min(3, pages - page + 1) }, (_, i) =>
      loadRankingPage("trending", page + i, newest.edition)));
    if (batch.some(result => result.status !== 200)) throw Error("RISING_RANKING_UNAVAILABLE");
    for (const result of batch) all.push(...result.posts);
  }
  return [...new Map(all.filter(post => publicPostId(post.x_post_id) && !post.manual_id)
    .map(post => [post.x_post_id, post])).values()];
}

async function openCounts(ids: string[]) {
  const since = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString();
  const counts = new Map<string, number>();
  for (let start = 0; start < ids.length; start += 100) {
    const chunk = ids.slice(start, start + 100);
    for (let offset = 0; ; offset += PAGE_SIZE) {
      if (offset >= 20000) throw Error("RISING_EVENT_LIMIT");
      const result = await supabaseAdmin().from("engagement_events").select("x_post_id")
        .eq("event_type", "video_open").gte("occurred_at", since)
        .in("x_post_id", chunk).range(offset, offset + PAGE_SIZE - 1);
      if (result.error) throw Error("RISING_EVENTS_UNAVAILABLE");
      const rows = result.data ?? [];
      for (const row of rows) {
        const id = String(row.x_post_id ?? "");
        if (chunk.includes(id)) counts.set(id, (counts.get(id) ?? 0) + 1);
      }
      if (rows.length < PAGE_SIZE) break;
    }
  }
  return counts;
}

export async function collectRisingRanking(): Promise<{ posts: RisingPost[]; windowDays: number }> {
  const candidates = await rankingCandidates();
  const [opens, catalog] = await Promise.all([
    openCounts(candidates.map(post => post.x_post_id)),
    createPublicCatalog(publicCatalogDirectory()).read()
  ]);
  const ranked = rankRising(candidates.map(post => ({
    id: post.x_post_id, post, opens: opens.get(post.x_post_id) ?? 0,
    saves: catalog.records[post.x_post_id]?.saves ?? 0
  })));
  return { posts: ranked.map(row => ({ ...row.post, siteOpens: row.opens, siteSaves: row.saves, risingScore: row.score })),
    windowDays: WINDOW_DAYS };
}

function validRising(value: unknown): value is Awaited<ReturnType<typeof collectRisingRanking>> {
  if (!value || typeof value !== "object") return false;
  const row = value as { posts?: unknown; windowDays?: unknown };
  return row.windowDays === WINDOW_DAYS && Array.isArray(row.posts) && row.posts.length <= 50 &&
    row.posts.every(post => post && typeof post === "object" &&
      publicPostId((post as RisingPost).x_post_id) &&
      Number.isSafeInteger((post as RisingPost).siteOpens) && (post as RisingPost).siteOpens > 0 &&
      Number.isSafeInteger((post as RisingPost).siteSaves) && (post as RisingPost).siteSaves >= 0 &&
      Number.isSafeInteger((post as RisingPost).risingScore));
}

export async function loadRisingRanking(options: { deferRefresh?: (refresh: () => Promise<void>) => void } = {}): Promise<{ posts: RisingPost[]; windowDays: number; updatedAt: string }> {
  const snapshot = await fourHourSnapshot(publicCatalogDirectory(), "rising-ranking-v2",
    collectRisingRanking, validRising, Date.now, options);
  // Recheck current publication/removal and reference permissions even when the
  // ranking scores come from a cached snapshot. Never cache those permissions.
  const live = await productionPublicBackend().service.inspect(snapshot.value.posts.map(post => post.x_post_id));
  const visible = new Map(live.filter(video => video.eligible).map(video => [video.id, video]));
  // Compact list snapshots omit video_url. Recheck each current post and use its
  // current media and attribution; reject changed URLs when an older snapshot
  // actually recorded one. Never restore a removed or blocked post.
  const posts = snapshot.value.posts.flatMap(post => {
    const current = visible.get(post.x_post_id);
    if (!current || (post.video_url && post.video_url !== current.videoUrl)) return [];
    return [{ ...post, video_url: current.videoUrl, preview_image_url: current.posterUrl,
      author_name: current.authorName, author_username: current.handle }];
  });
  return { ...snapshot.value, posts, updatedAt: snapshot.updatedAt };
}
