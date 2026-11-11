/** Pure helpers for "new since your last visit". IDs are numeric strings (snowflake-like). */
export const LAST_SEEN_KEY = "twizou_last_seen_v1";
export const SESSION_BANNER_KEY = "twizou_new_banner_v1";
/** A gap longer than this counts as a new visit. */
export const VISIT_GAP_MS = 30 * 60 * 1000;

export type NewSince = { count: number; indexes: number[]; sinceMs: number };

const validId = (value: unknown): value is string => typeof value === "string" && /^[1-9][0-9]{1,24}$/.test(value);
// Numeric-string comparison without BigInt: longer is larger, then lexicographic.
export function compareIds(a: string, b: string): number {
  return a.length !== b.length ? a.length - b.length : a < b ? -1 : a > b ? 1 : 0;
}

export function newSinceVisit(ids: string[], storedTop: unknown, storedAt: unknown, now: number): NewSince | null {
  if (!validId(storedTop) || typeof storedAt !== "number" || !Number.isFinite(storedAt) || storedAt > now) return null;
  const sinceMs = now - storedAt;
  if (sinceMs < VISIT_GAP_MS) return null;
  const indexes = ids.flatMap((id, index) => validId(id) && compareIds(id, storedTop) > 0 ? [index] : []);
  return indexes.length ? { count: indexes.length, indexes, sinceMs } : null;
}

export function newestId(ids: string[], previous: unknown): string | null {
  let best: string | null = validId(previous) ? previous : null;
  for (const id of ids) if (validId(id) && (best === null || compareIds(id, best) > 0)) best = id;
  return best;
}

export function sinceLabel(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${Math.max(minutes, 1)}分前`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}時間前` : `${Math.floor(hours / 24)}日前`;
}
