// Daily record of the site's own rankings (Japan-time day -> ordered post ids). A small JSON file beside the public catalog.
// Each day keeps the latest list seen that day for the 24-hour and weekly rankings. Writes are throttled and never block browsing.
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { acquirePublicOperation } from "./public-operation-lock";

export type RankRange = "daily" | "weekly";
export type RankDay = { daily?: string[]; weekly?: string[]; at: string };
export type RankHistory = { version: 1; days: Record<string, RankDay> };
export type RankPostStats = { best: number; days: number; firstDay: string; lastDay: string };
export type RankStats = { days: string[]; day: (date: string) => RankDay | null; posts: Map<string, RankPostStats> };

export const RANK_HISTORY_LIMIT = 100, RANK_HISTORY_MAX_DAYS = 800, RANK_HISTORY_WRITE_MS = 30 * 60 * 1000;
const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, POST_ID = /^[1-9][0-9]{1,24}$/;
export const validRankDay = (value: unknown): value is string => typeof value === "string" && DAY.test(value) && !Number.isNaN(Date.parse(value + "T00:00:00Z")) && new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;
export const jstDay = (time: number) => new Date(time + 9 * 3600000).toISOString().slice(0, 10);
const validList = (v: unknown): v is string[] => Array.isArray(v) && v.length <= RANK_HISTORY_LIMIT && v.every(id => typeof id === "string" && POST_ID.test(id));

function parse(text: string): RankHistory {
  const blank: RankHistory = { version: 1, days: {} };
  let raw: any; try { raw = JSON.parse(text); } catch { return blank; }
  if (!raw || raw.version !== 1 || !raw.days || typeof raw.days !== "object") return blank;
  for (const [day, value] of Object.entries(raw.days as Record<string, any>)) {
    if (!validRankDay(day) || !value || typeof value.at !== "string") continue;
    const entry: RankDay = { at: value.at };
    if (validList(value.daily)) entry.daily = value.daily;
    if (validList(value.weekly)) entry.weekly = value.weekly;
    if (entry.daily || entry.weekly) blank.days[day] = entry;
  }
  return blank;
}

/** Per-post statistics from the 24-hour ranking lists: best position, number of days listed, first and last day. */
export function rankStats(history: RankHistory): RankStats {
  const days = Object.keys(history.days).sort().reverse(), posts = new Map<string, RankPostStats>();
  for (const day of [...days].reverse()) {
    (history.days[day].daily ?? []).forEach((id, index) => {
      const row = posts.get(id);
      if (!row) posts.set(id, { best: index + 1, days: 1, firstDay: day, lastDay: day });
      else { row.best = Math.min(row.best, index + 1); row.days++; row.lastDay = day; }
    });
  }
  return { days, day: date => history.days[date] ?? null, posts };
}

export function createRankHistoryStore(root: string, now: () => number = Date.now) {
  const file = path.join(root, "rank-history.json"), lockFile = path.join(root, ".rank-history.lock");
  let cache: { mtimeMs: number; size: number; history: RankHistory; stats: RankStats } | null = null;
  const written = new Map<string, number>();
  async function load() {
    let stat; try { stat = await fs.stat(file); } catch { const history: RankHistory = { version: 1, days: {} }; return { history, stats: rankStats(history) }; }
    if (cache && cache.mtimeMs === stat.mtimeMs && cache.size === stat.size) return cache;
    if (!stat.isFile() || stat.size > 8 * 1024 * 1024) throw Error("RANK_HISTORY_UNREADABLE");
    const history = parse(await fs.readFile(file, "utf8"));
    cache = { mtimeMs: stat.mtimeMs, size: stat.size, history, stats: rankStats(history) };
    return cache;
  }
  const read = async () => (await load()).stats;
  /** Remember today's list for one ranking. Returns true when the file was written. Busy or throttled calls do nothing. */
  async function record(range: RankRange, ids: string[], at: string) {
    const time = Date.parse(at);
    if ((range !== "daily" && range !== "weekly") || !Number.isFinite(time)) return false;
    const list = [...new Set(ids.filter(id => POST_ID.test(id)))].slice(0, RANK_HISTORY_LIMIT);
    if (list.length < 3) return false;
    const day = jstDay(time), key = day + ":" + range, last = written.get(key);
    if (last !== undefined && now() - last < RANK_HISTORY_WRITE_MS) return false;
    const current = (await load()).history.days[day];
    if (current?.[range] && current[range]!.join() === list.join()) { written.set(key, now()); return false; }
    await fs.mkdir(root, { recursive: true, mode: 0o700 });
    let lock; try { lock = await acquirePublicOperation(lockFile, "RANK_HISTORY_BUSY"); } catch { return false; }
    try {
      cache = null;
      const history = (await load()).history, next: RankHistory = { version: 1, days: { ...history.days } };
      next.days[day] = { ...(next.days[day] ?? {}), [range]: list, at: new Date(time).toISOString() };
      for (const old of Object.keys(next.days).sort().reverse().slice(RANK_HISTORY_MAX_DAYS)) delete next.days[old];
      const temp = path.join(root, ".rank-history-" + randomUUID() + ".tmp");
      try { await fs.writeFile(temp, JSON.stringify(next), { flag: "wx", mode: 0o600 }); await fs.rename(temp, file); } finally { await fs.unlink(temp).catch(() => undefined); }
      cache = null; written.set(key, now());
      for (const k of written.keys()) if (!k.startsWith(day)) written.delete(k);
      return true;
    } finally { await lock.release(); }
  }
  return { read, record };
}
