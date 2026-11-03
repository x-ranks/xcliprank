export const RANKING_PAGE_SIZE = 50;
export type RankingPagination = {
  page: number; pageSize: number; totalPosts: number; totalPages: number;
  edition: string; previousHref: string | null; nextHref: string | null;
};
export function parseRankingPage(value: string | null | undefined) {
  if (value == null) return 1;
  if (!/^(?:[1-9]|10)$/.test(value)) throw Error("INVALID_RANKING_PAGE");
  return Number(value);
}
export function newestPageHref(page: number, edition?: string) {
  const query = new URLSearchParams();
  if (page > 1) query.set("page", String(page));
  if (edition) query.set("edition", edition);
  return query.size ? "/?" + query.toString() : "/";
}
export function rankingHref(range: "trending" | "daily" | "weekly", edition?: string) {
  const base = range === "trending" ? "/" : "/ranking/" + range;
  return edition ? base + "?edition=" + encodeURIComponent(edition) : base;
}
