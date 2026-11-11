export const X_PROMOTION_METRICS_STORAGE_KEY = "twizou_x_promotion_metrics_v1";

export type PostMetrics = {
  postUrl: string;
  impressions: number;
  likes: number | null;
  reposts: number | null;
  replies: number | null;
  profileVisits: number | null;
  linkClicks: number | null;
  capturedAt: string;
};

const validCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000;

export function readPostMetrics(raw: string | null): PostMetrics[] {
  if (!raw || raw.length > 100_000) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is PostMetrics => {
      if (!item || typeof item !== "object") return false;
      const row = item as Record<string, unknown>;
      return typeof row.postUrl === "string" && /^https:\/\/(?:x|twitter)\.com\/(?:[A-Za-z0-9_]{1,15}|i\/web)\/status\/\d{1,25}\/?(?:\?.*)?$/.test(row.postUrl) &&
        validCount(row.impressions) && (row.likes === null || validCount(row.likes)) &&
        (row.reposts === null || validCount(row.reposts)) &&
        (row.replies === null || validCount(row.replies)) &&
        (row.profileVisits === null || validCount(row.profileVisits)) &&
        (row.linkClicks === undefined || row.linkClicks === null || validCount(row.linkClicks)) &&
        typeof row.capturedAt === "string" && Number.isFinite(Date.parse(row.capturedAt));
    }).slice(0, 200);
  } catch {
    return [];
  }
}

export function postMetricsSummary(row: PostMetrics, siteVisits: number) {
  const reactions = row.likes !== null && row.reposts !== null && row.replies !== null
    ? row.likes + row.reposts + row.replies : null;
  return {
    reactions,
    reactionRate: row.impressions > 0 && reactions !== null ? reactions / row.impressions : null,
    linkClickRate: row.impressions > 0 && typeof row.linkClicks === "number" ? row.linkClicks / row.impressions : null,
    siteVisitRate: row.impressions > 0 ? siteVisits / row.impressions : null,
  };
}

export function summarizeCopyStyles(rows: { style: string; impressions: number; visits: number }[]) {
  const groups = new Map<string, { impressions: number[]; visits: number[] }>();
  for (const row of rows) {
    if (!["curiosity", "ranking", "creator"].includes(row.style) || !validCount(row.impressions) || !validCount(row.visits)) continue;
    const group = groups.get(row.style) ?? { impressions: [], visits: [] };
    group.impressions.push(row.impressions);
    group.visits.push(row.visits);
    groups.set(row.style, group);
  }
  const median = (values: number[]) => {
    const sorted = values.slice().sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  };
  return [...groups].filter(([, group]) => group.impressions.length >= 3).map(([style, group]) => ({
    style, samples: group.impressions.length,
    medianImpressions: median(group.impressions), medianVisits: median(group.visits),
  })).sort((a, b) => b.medianImpressions - a.medianImpressions);
}
