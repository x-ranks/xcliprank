import "server-only";
import { readRankingUpdate } from "./ranking-update";
import { NextRequest } from "next/server";
import { GET as getRankings } from "../app/api/rankings/route";
import type { Range, RankPost } from "../app/components/RankingClient";
import type { RankingPagination } from "./ranking-pagination";
export async function loadRankingPage(range: Range, page?: number, edition?: string) {
  const query = new URLSearchParams({ range });
  if (page != null) query.set("page", String(page));
  if (edition) query.set("edition", edition);
  const response = await getRankings(new NextRequest("http://internal.local/api/rankings?" + query));
  const body = await response.json();
  return { status: response.status, posts: Array.isArray(body.data) ? body.data as RankPost[] : [],
    edition: typeof body.edition === "string" ? body.edition : undefined,
    update: readRankingUpdate(body),
    pagination: body.pagination as RankingPagination | undefined };
}
// Read current visibility on every view rather than independently caching rendered rows.
export async function loadInitialRanking(range: Range): Promise<RankPost[]> {
  try { const result = await loadRankingPage(range); return result.status === 200 ? result.posts : []; }
  catch { console.error("INITIAL RANKING ERROR: load failed"); return []; }
}
