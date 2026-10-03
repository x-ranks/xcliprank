import "server-only";

import { unstable_cache } from "next/cache";
import { NextRequest } from "next/server";
import { GET as getRankings } from "../app/api/rankings/route";
import type { Range, RankPost } from "../app/components/RankingClient";

const loadCachedInitialRanking = unstable_cache(async (
  range: Range
): Promise<RankPost[]> => {
  try {
    const request = new NextRequest(
      `http://internal.local/api/rankings?range=${range}`
    );
    const response = await getRankings(request);

    if (!response.ok) {
      console.error(
        "INITIAL RANKING ERROR:",
        response.status
      );
      return [];
    }

    const body = await response.json();
    return Array.isArray(body.data)
      ? (body.data as RankPost[])
      : [];
  } catch (error) {
    console.error("INITIAL RANKING ERROR:", error);
    return [];
  }
}, ["initial-ranking-liquidity-v2"], {
  revalidate: 1
});

export async function loadInitialRanking(
  range: Range
) {
  return loadCachedInitialRanking(range);
}

