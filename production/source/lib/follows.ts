/** Followed accounts, kept only in this browser. Account keys only; videos are read live. */
type StorageLike = Pick<Storage, "getItem" | "setItem">;
const KEY = "twizou-follows-v1";
const SEEN_KEY = "twizou-follow-seen-v1";
export const FOLLOW_LIMIT = 30;
export const FOLLOW_EVENT = "twizou-follows-changed";
/** Same shape as the public account key: a lower-case X handle or id-<author id>. */
export const ACCOUNT_KEY = /^(?:[a-z0-9_]{1,15}|id-[A-Za-z0-9_-]{1,64})$/;
export const validAccountKey = (value: unknown): value is string => typeof value === "string" && ACCOUNT_KEY.test(value);

export function readFollows(storage: StorageLike): string[] {
  try {
    const value = JSON.parse(storage.getItem(KEY) || "[]");
    return Array.isArray(value) ? [...new Set(value.filter(validAccountKey))].slice(0, FOLLOW_LIMIT) : [];
  } catch { return []; }
}

/** Newest follow first. Returns false when the key is invalid, storage fails or the limit is reached. */
export function setFollow(storage: StorageLike, key: string, present: boolean): boolean {
  if (!validAccountKey(key)) return false;
  try {
    const rest = readFollows(storage).filter(value => value !== key);
    if (present && rest.length >= FOLLOW_LIMIT) return false;
    storage.setItem(KEY, JSON.stringify(present ? [key, ...rest] : rest));
    return true;
  } catch { return false; }
}

/** When the person last looked at the follow feed (epoch ms); 0 when never. */
export function readFollowSeen(storage: StorageLike): number {
  try {
    const value = Number(storage.getItem(SEEN_KEY));
    return Number.isSafeInteger(value) && value > 0 ? value : 0;
  } catch { return 0; }
}

export function writeFollowSeen(storage: StorageLike, now: number): boolean {
  try { storage.setItem(SEEN_KEY, String(Math.floor(now))); return true; } catch { return false; }
}

/** A video is new when it was posted after the last look. The very first look marks nothing as new. */
export function isNewForFollower(createdAt: string | null, seen: number): boolean {
  if (!seen || !createdAt) return false;
  const time = Date.parse(createdAt);
  return Number.isFinite(time) && time > seen;
}

/** Adds imported account keys after the existing ones, up to the follow limit. Returns how many were new, or null when storage fails. */
export function mergeFollows(storage: StorageLike, incoming: unknown): number | null {
  try {
    const current = readFollows(storage), have = new Set(current);
    const extra = (Array.isArray(incoming) ? [...new Set(incoming.filter(validAccountKey))] : []).filter(key => !have.has(key));
    const take = extra.slice(0, Math.max(0, FOLLOW_LIMIT - current.length));
    storage.setItem(KEY, JSON.stringify([...current, ...take]));
    return take.length;
  } catch { return null; }
}
