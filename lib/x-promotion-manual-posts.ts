export const X_PROMOTION_MANUAL_POSTS_KEY = "twizou_x_promotion_manual_posts_v1";

export type ManualPostRecord = {
  postUrl: string;
  sourceId: string;
  text: string;
  utmContent: string;
  createdAt: string;
  style: "curiosity" | "ranking" | "creator";
};

export function validXPostUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && ["x.com", "twitter.com"].includes(url.hostname) &&
      /^\/(?:[A-Za-z0-9_]{1,15}|i\/web)\/status\/\d{1,25}\/?$/.test(url.pathname);
  } catch { return false; }
}

export function readManualPosts(raw: string | null): ManualPostRecord[] {
  if (!raw || raw.length > 100_000) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is ManualPostRecord => {
      if (!item || typeof item !== "object") return false;
      const row = item as Record<string, unknown>;
      return typeof row.postUrl === "string" && validXPostUrl(row.postUrl) &&
        typeof row.sourceId === "string" && /^\d{1,25}$/.test(row.sourceId) &&
        typeof row.text === "string" && row.text.length <= 280 &&
        typeof row.utmContent === "string" && /^kit_\d{1,25}_\d{8}$/.test(row.utmContent) &&
        ["curiosity", "ranking", "creator"].includes(String(row.style)) &&
        typeof row.createdAt === "string" && Number.isFinite(Date.parse(row.createdAt));
    }).slice(0, 100);
  } catch { return []; }
}
