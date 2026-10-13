import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { LIQUIDITY_WINDOW_MS } from "./ranking-liquidity";

export const EDITION_TTL_MS = 24 * 60 * 60 * 1000;
export type EditionEntry = { id: string; ranking_supplemented?: boolean; ranking_slot?: string; ranking_value?: number; visual_preference_applied?: boolean; visual_preference_percentile?: number | null; combined_ranking_percentile?: number };
export type RankingEdition = {
  version: 1; edition: string; snapshot: number;
  plans: { trending: EditionEntry[]; daily: EditionEntry[]; weekly: EditionEntry[]; weeklyBase: EditionEntry[] };
  metadata: Record<string, any>;
};
export function editionId(snapshot: number, blocked: Iterable<string>) {
  const revision = createHash("sha256").update([...blocked].sort().join("|")).digest("hex").slice(0, 12);
  return snapshot + "-" + revision;
}
export function validateEditionId(value: string, now = Date.now()) {
  if (!/^\d{13}-[a-f0-9]{12}$/.test(value)) throw Error("INVALID_RANKING_EDITION");
  const snapshot = Number(value.slice(0, 13));
  if (snapshot % LIQUIDITY_WINDOW_MS !== 0 || snapshot > now + LIQUIDITY_WINDOW_MS) throw Error("INVALID_RANKING_EDITION");
  if (now - snapshot >= EDITION_TTL_MS) throw Error("RANKING_EDITION_EXPIRED");
  return snapshot;
}
export function editionEntry(post: any): EditionEntry {
  const row: EditionEntry = { id: String(post.x_post_id ?? post.id) };
  for (const key of ["ranking_supplemented", "ranking_slot", "ranking_value", "visual_preference_applied", "visual_preference_percentile", "combined_ranking_percentile"] as const) {
    if (post[key] !== undefined) (row as any)[key] = post[key];
  }
  return row;
}
function validate(value: any, expected: string): RankingEdition {
  if (value?.version !== 1 || value.edition !== expected || value.snapshot !== Number(expected.slice(0, 13)) || !value.plans || !value.metadata || typeof value.metadata !== "object" || Array.isArray(value.metadata)) throw Error("RANKING_EDITION_UNREADABLE");
  for (const name of ["trending", "daily", "weekly", "weeklyBase"] as const) {
    const rows = value.plans[name];
    if (!Array.isArray(rows) || rows.length > (name === "trending" ? 500 : 100)) throw Error("RANKING_EDITION_UNREADABLE");
    const seen = new Set<string>();
    for (const row of rows) {
      if (!row || typeof row.id !== "string" || !/^\d{2,20}$/.test(row.id) || seen.has(row.id) || Object.keys(row).some(k => !["id", "ranking_supplemented", "ranking_slot", "ranking_value", "visual_preference_applied", "visual_preference_percentile", "combined_ranking_percentile"].includes(k))) throw Error("RANKING_EDITION_UNREADABLE");
      if (row.ranking_slot != null && !["recent", "random_archive", "fixed_archive", "extra_archive"].includes(row.ranking_slot)) throw Error("RANKING_EDITION_UNREADABLE");
      if (["ranking_supplemented", "visual_preference_applied"].some(k => row[k] != null && typeof row[k] !== "boolean")) throw Error("RANKING_EDITION_UNREADABLE");
      if (["ranking_value", "visual_preference_percentile", "combined_ranking_percentile"].some(k => row[k] != null && !Number.isFinite(row[k]))) throw Error("RANKING_EDITION_UNREADABLE");
      seen.add(row.id);
    }
  }
  const reserved = new Set([...value.plans.daily, ...value.plans.weekly, ...value.plans.weeklyBase].map((r: EditionEntry) => r.id));
  if (value.plans.trending.some((r: EditionEntry) => reserved.has(r.id))) throw Error("RANKING_EDITION_UNREADABLE");
  return value;
}
async function directory() {
  const root = path.resolve(process.env.XCLIP_RANKING_FEED_STATE_DIR || path.join(os.homedir(), ".xclip-ranking-feed"));
  if (!path.isAbsolute(process.env.XCLIP_RANKING_FEED_STATE_DIR || root)) throw Error("RANKING_STATE_DIRECTORY_INVALID");
  const cwd = path.resolve(process.cwd());
  if (root === cwd || root.startsWith(cwd + path.sep)) throw Error("RANKING_STATE_DIRECTORY_MUST_BE_DURABLE");
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  if ((await fs.lstat(root)).isSymbolicLink() || await fs.realpath(root) !== root) throw Error("RANKING_STATE_DIRECTORY_INVALID");
  return root;
}
export async function readEdition(edition: string): Promise<RankingEdition | null> {
  validateEditionId(edition);
  const file = path.join(await directory(), edition + ".json");
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 512 * 1024) throw Error("RANKING_EDITION_UNREADABLE");
    return validate(JSON.parse(await fs.readFile(file, "utf8")), edition);
  } catch (error: any) {
    if (error.code === "ENOENT") return null;
    throw Error("RANKING_EDITION_UNREADABLE");
  }
}
export async function saveEdition(value: RankingEdition): Promise<RankingEdition> {
  validateEditionId(value.edition); validate(value, value.edition);
  const root = await directory(), target = path.join(root, value.edition + ".json"), temp = path.join(root, ".edition-" + randomUUID() + ".tmp");
  try {
    await fs.writeFile(temp, JSON.stringify(value), { flag: "wx", mode: 0o600 });
    // Atomic create-if-absent: a concurrent worker cannot replace a published order.
    try { await fs.link(temp, target); } catch (error: any) { if (error.code !== "EEXIST") throw error; }
  } finally { await fs.unlink(temp).catch(() => {}); }
  const winner = await readEdition(value.edition);
  if (!winner) throw Error("RANKING_EDITION_UNREADABLE");
  // Expired order files only; never touch patrol, deletion, quota or DB state.
  for (const name of await fs.readdir(root)) {
    if (!/^\d{13}-[a-f0-9]{12}\.json$/.test(name) || Date.now() - Number(name.slice(0, 13)) < EDITION_TTL_MS) continue;
    const file = path.join(root, name), stat = await fs.lstat(file);
    if (stat.isFile() && !stat.isSymbolicLink()) await fs.unlink(file).catch(() => {});
  }
  return winner;
}
