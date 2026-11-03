import { recordPublicRankingFreshness } from "./public-response-metadata";
import "server-only";
import { readRankingUpdate } from "./ranking-update";
import { NextRequest } from "next/server";
import { GET as getRankings } from "../app/api/rankings/route";
import type { Range, RankPost } from "../app/components/RankingClient";
import type { RankingPagination } from "./ranking-pagination";
// Only the fields consumed by public cards/reels cross the server/client boundary.
export function rankingClientRows(rows: RankPost[]): RankPost[] {
  const common = ["author_id","x_post_id","ranking_position","author_username","author_name","preview_image_url","views","likes","bookmarks","reposts"] as const;
  const manual = ["x_url","video_url","video_bitrate","score","adult_tier","created_at","ranking_supplemented","manual_id","manual_media_url","manual_title","replies"] as const;
  return rows.map(row => Object.fromEntries([
    ...common.filter(key => row[key] !== undefined).map(key => [key,row[key]]),
    ...(row.manual_id ? manual.filter(key => row[key] !== undefined).map(key => [key,row[key]]) : [["has_video", Boolean(row.video_url)]])
  ]) as RankPost);
}
export async function loadRankingPage(range: Range, page?: number, edition?: string) {
  const query = new URLSearchParams({ range });
  if (page != null) query.set("page", String(page));
  if (edition) query.set("edition", edition);
  const response = await getRankings(new NextRequest("http://internal.local/api/rankings?" + query));
  recordPublicRankingFreshness(response);
  const body = await response.json();
  return { status: response.status, posts: Array.isArray(body.data) ? rankingClientRows(body.data as RankPost[]) : [],
    edition: typeof body.edition === "string" ? body.edition : undefined,
    update: readRankingUpdate(body),
    pagination: body.pagination as RankingPagination | undefined };
}
// Read current visibility on every view rather than independently caching rendered rows.
export async function loadInitialRanking(range: Range): Promise<RankPost[]> {
  try { const result = await loadRankingPage(range); return result.status === 200 ? result.posts : []; }
  catch { console.error("INITIAL RANKING ERROR: load failed"); return []; }
}
