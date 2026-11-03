import { manualCuratedKeys } from "./curated-removals";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { authorStateDirectory, suspendedAuthorKeys } from "./author-status-store";
import type { PostIdentity } from "./post-status";
export type PostEntry = { authorKey: string | null; checkedAt: number; nextCheckAt: number; missingSince: number; lastMissingAt: number; blocked: boolean };
export type PostState = { version: 1; entries: Record<string, PostEntry>; cursor: string | null; cycleStartedAt: number;
  cycleCompletedAt: number; nextBatchAt: number; cooldownUntil: number };
export const POST_STATE_LIMIT = 50000;
export const emptyPostState = (): PostState => ({ version: 1, entries: {}, cursor: null, cycleStartedAt: 0,
  cycleCompletedAt: 0, nextBatchAt: 0, cooldownUntil: 0 });
const idValid = (s: unknown) => typeof s === "string" && /^\d{2,20}$/.test(s);
const validAuthor = (s: unknown) => s === null || typeof s === "string" && /^(?:id:\d{2,20}|name:[a-z0-9_]{1,15})$/.test(s);
export async function readPostState(directory = authorStateDirectory()): Promise<PostState> {
  try {
    const file = path.join(directory, "post-state-v1.json"), stat = await fs.stat(file);
    if (stat.size > 16 * 1024 * 1024) throw Error("POST_STATE_TOO_LARGE");
    const state = JSON.parse(await fs.readFile(file, "utf8"));
    if (state?.version !== 1 || !state.entries || typeof state.entries !== "object" || Array.isArray(state.entries) ||
        Object.keys(state.entries).length > POST_STATE_LIMIT || (state.cursor !== null && !idValid(state.cursor)) ||
        [state.cycleStartedAt, state.cycleCompletedAt, state.nextBatchAt, state.cooldownUntil].some(n => !Number.isFinite(n) || n < 0)) throw Error("POST_STATE_INVALID");
    for (const [id, entry] of Object.entries(state.entries) as [string, PostEntry][]) {
      if (!idValid(id) || !entry || !validAuthor(entry.authorKey) || typeof entry.blocked !== "boolean" ||
          [entry.checkedAt, entry.nextCheckAt, entry.missingSince, entry.lastMissingAt].some(n => !Number.isFinite(n) || n < 0)) throw Error("POST_STATE_INVALID");
    }
    return state;
  } catch (error: any) {
    if (error.code === "ENOENT") return emptyPostState();
    throw Error("POST_STATE_UNREADABLE");
  }
}
export async function writePostState(state: PostState, directory = authorStateDirectory()) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const target = path.join(directory, "post-state-v1.json"), temp = target + "." + randomBytes(8).toString("hex") + ".tmp";
  try { await fs.writeFile(temp, JSON.stringify(state), { mode: 0o600, flag: "wx" }); await fs.rename(temp, target); }
  finally { await fs.unlink(temp).catch(() => {}); }
}
export function entryPost(id: string, entry: PostEntry): PostIdentity {
  return { x_post_id: id, ...(entry.authorKey?.startsWith("id:") ? { author_id: entry.authorKey.slice(3) } :
    entry.authorKey?.startsWith("name:") ? { author_username: entry.authorKey.slice(5) } : {}) };
}
// Parse the large registry once per atomic file replacement, rather than once per view.
const cache = new Map<string, { stamp: string; keys: string[] }>();
export async function unavailableKeys(directory = authorStateDirectory()) {
  const authors = await suspendedAuthorKeys(directory); for(const key of await manualCuratedKeys())authors.add(key); const file = path.join(directory, "post-state-v1.json");
  let stat; try { stat = await fs.stat(file); } catch (error: any) { if (error.code === "ENOENT") return authors; throw error; }
  const stamp = `${stat.dev}:${stat.ino}:${stat.mtimeMs}:${stat.size}`, old = cache.get(directory);
  const keys = old?.stamp === stamp ? old.keys : Object.entries((await readPostState(directory)).entries)
    .filter(([, entry]) => entry.blocked).map(([id]) => `post:${id}`);
  cache.set(directory, { stamp, keys }); for (const key of keys) authors.add(key); return authors;
}
