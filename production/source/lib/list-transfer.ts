/** Move favorites, save history and followed authors to another browser with a copy-and-paste code. IDs only, no network. */
import { mergeVideoLists, readVideoLists } from "./local-video-lists";
import { mergeFollows, readFollows } from "./follows";
type StorageLike = Pick<Storage, "getItem" | "setItem">;
const PREFIX = "TWZ1.", MAX_CODE_LENGTH = 200000;
const idPattern = /^[1-9][0-9]{1,24}$/;
// Numeric IDs are written in base 36 to keep the code short.
const packId = (id: string) => BigInt(id).toString(36);
function unpackId(value: string): string | null {
  if (!/^[0-9a-z]{1,17}$/.test(value)) return null;
  let n = BigInt(0); for (const ch of value) n = n * BigInt(36) + BigInt(parseInt(ch, 36));
  const id = n.toString(); return idPattern.test(id) ? id : null;
}
const toBase64Url = (text: string) => {
  const bytes = new TextEncoder().encode(text); let bin = ""; for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const fromBase64Url = (value: string) => {
  const bin = atob(value.replace(/-/g, "+").replace(/_/g, "/")); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
};

export function exportTransferCode(storage: StorageLike): string {
  const lists = readVideoLists(storage);
  return PREFIX + toBase64Url(JSON.stringify({ f: lists.favorites.map(packId), s: lists.saveHistory.map(packId), a: readFollows(storage) }));
}

export type ImportResult = { ok: true; favorites: number; saveHistory: number; follows: number } | { ok: false; reason: "format" | "storage" };
export function importTransferCode(storage: StorageLike, code: string): ImportResult {
  const text = code.replace(/\s+/g, "");
  if (!text.startsWith(PREFIX) || text.length > MAX_CODE_LENGTH) return { ok: false, reason: "format" };
  let data: { f?: unknown; s?: unknown; a?: unknown };
  try { data = JSON.parse(fromBase64Url(text.slice(PREFIX.length))); } catch { return { ok: false, reason: "format" }; }
  if (!data || typeof data !== "object") return { ok: false, reason: "format" };
  const ids = (value: unknown) => Array.isArray(value) ? value.map(item => typeof item === "string" ? unpackId(item) : null).filter((id): id is string => id !== null) : [];
  const lists = mergeVideoLists(storage, { favorites: ids(data.f), saveHistory: ids(data.s) }), follows = mergeFollows(storage, data.a);
  return lists && follows !== null ? { ok: true, favorites: lists.favorites, saveHistory: lists.saveHistory, follows } : { ok: false, reason: "storage" };
}
