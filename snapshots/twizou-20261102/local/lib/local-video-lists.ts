/** IDs only: media and public metadata stay on their original sources. */
export type VideoListKind = "favorites" | "saveHistory";
type StorageLike = Pick<Storage, "getItem" | "setItem">;
const KEY = "twizou-video-lists-v1";
const LIMIT = 1000;
const validId = (value: unknown): value is string => typeof value === "string" && /^[1-9][0-9]{1,24}$/.test(value);
type Lists = Record<VideoListKind, string[]>;

function normalize(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(validId))].slice(0, LIMIT);
}

export function readVideoLists(storage: StorageLike): Lists {
  try {
    const value = JSON.parse(storage.getItem(KEY) || "{}");
    return { favorites: normalize(value?.favorites), saveHistory: normalize(value?.saveHistory) };
  } catch { return { favorites: [], saveHistory: [] }; }
}

export function setVideoListEntry(storage: StorageLike, kind: VideoListKind, id: string, present: boolean): boolean {
  if (!validId(id)) return false;
  try {
    const lists = readVideoLists(storage);
    const rest = lists[kind].filter(value => value !== id);
    if (kind === "favorites" && present && rest.length >= LIMIT) return false;
    lists[kind] = present ? [id, ...rest].slice(0, LIMIT) : rest;
    storage.setItem(KEY, JSON.stringify(lists));
    return true;
  } catch { return false; }
}
