export type RankingUpdate = { updatedAt: string | null; snapshotAt: string | null; precise: boolean };
export const EMPTY_RANKING_UPDATE: RankingUpdate = { updatedAt: null, snapshotAt: null, precise: false };

function iso(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

// Read the saved list's time. The response/request time never stands in for an update.
export function readRankingUpdate(body: any): RankingUpdate {
  const edition = typeof body?.edition === "string" && /^\d{13}-[a-f0-9]{12}$/.test(body.edition)
    ? Number(body.edition.slice(0, 13)) : null;
  const snapshotAt = iso(body?.rankingSnapshotAt) ?? iso(body?.liquidity?.snapshotAt) ??
    (edition !== null ? new Date(edition).toISOString() : null);
  const updatedAt = iso(body?.rankingUpdatedAt);
  return { updatedAt, snapshotAt, precise: updatedAt !== null };
}

export function formatRankingTime(value: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).format(new Date(value));
}

export function latestRankingHref(range: "trending" | "daily" | "weekly") {
  return range === "trending" ? "/" : `/ranking/${range}`;
}
