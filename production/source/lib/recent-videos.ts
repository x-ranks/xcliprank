/** Recently opened video IDs, kept only in this browser. IDs only; metadata is read live. */
type StorageLike = Pick<Storage, "getItem" | "setItem">;
const KEY = "twizou-recent-v1";
const LIMIT = 100;
const validId = (value: unknown): value is string => typeof value === "string" && /^[1-9][0-9]{1,24}$/.test(value);

export function readRecent(storage: StorageLike): string[] {
  try {
    const value = JSON.parse(storage.getItem(KEY) || "[]");
    return Array.isArray(value) ? [...new Set(value.filter(validId))].slice(0, LIMIT) : [];
  } catch { return []; }
}

export function recordRecent(storage: StorageLike, id: string): boolean {
  if (!validId(id)) return false;
  try {
    const rest = readRecent(storage).filter(value => value !== id);
    storage.setItem(KEY, JSON.stringify([id, ...rest].slice(0, LIMIT)));
    return true;
  } catch { return false; }
}
