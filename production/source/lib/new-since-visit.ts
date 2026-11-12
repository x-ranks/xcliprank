/** Pure helpers for "new since your last visit". IDs are numeric strings (snowflake-like). */
export const LAST_SEEN_KEY = "twizou_last_seen_v1";
export const SESSION_BANNER_KEY = "twizou_new_banner_v1";
/** Per-tab record of where the current visit started, so every list in the visit compares against the same moment. */
export const BASELINE_KEY = "twizou_visit_baseline_v1";
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

export type Baseline = { top: string | null; at: number | null; touched: number };

/** The reference point for "new since your last visit". It is fixed when a visit starts (previous record from a
 *  gap of 30+ minutes) and kept for the rest of the visit, however many lists are opened. */
export function nextBaseline(session: unknown, previous: { top?: unknown; at?: unknown } | null, now: number): Baseline {
  const s = session as Partial<Baseline> | null;
  if (s && typeof s.touched === "number" && Number.isFinite(s.touched) && s.touched <= now && now - s.touched < VISIT_GAP_MS &&
      (s.top === null || validId(s.top)) && (s.at === null || (typeof s.at === "number" && Number.isFinite(s.at)))) {
    return { top: s.top ?? null, at: s.at ?? null, touched: now };
  }
  const top = validId(previous?.top) ? previous!.top as string : null;
  const at = typeof previous?.at === "number" && Number.isFinite(previous.at) ? previous.at : null;
  return { top, at, touched: now };
}
