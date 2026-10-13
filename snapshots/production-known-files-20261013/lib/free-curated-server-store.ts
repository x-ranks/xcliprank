import { validFreeMetrics, type FreeScanMetrics, type FreeRun } from "./free-curated-metrics";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomBytes } from "node:crypto";
import { FreeCuratedError, type FreeAuthor } from "./fxtwitter-curated";

export type ScheduledFreeAuthor = FreeAuthor & { source: "legacy" | "free"; paused: boolean; addedAt: number; checkedAt: number; nextCheckAt: number;
  latestId: string | null; pendingCursor: string | null; pendingLatestId: string | null; baselineId: string | null;
  savedTotal: number; lastError: string | null; metrics?: FreeScanMetrics; initialPending?: boolean; initialBaselineId?: string | null };
export type { FreeRun } from "./free-curated-metrics";
export type ScheduledFreeState = { version: 1; nextBatchAt: number; cooldownUntil: number; authors: ScheduledFreeAuthor[]; lastRun?:FreeRun };
export const serverRegistryDirectory = () => process.env.XCLIP_FREE_CURATED_STATE_DIR || path.join(os.homedir(), ".xclip-free-curated");
export const freshFreeState = (): ScheduledFreeState => ({ version: 1, nextBatchAt: 0, cooldownUntil: 0, authors: [] });
const validId = (s: unknown) => s === null || typeof s === "string" && /^\d{2,20}$/.test(s);
export async function readScheduledFreeState(directory = serverRegistryDirectory()): Promise<ScheduledFreeState> {
  try {
    const file = path.join(directory, "state-v1.json"), stat = await fs.stat(file);
    if (stat.size > 1024 * 1024) throw Error();
    const s = JSON.parse(await fs.readFile(file, "utf8")) as ScheduledFreeState;
    if (s?.version !== 1 || !Array.isArray(s.authors) || s.authors.length > 100 ||
      [s.nextBatchAt, s.cooldownUntil].some(n => !Number.isFinite(n) || n < 0) || new Set(s.authors.map(a => a.id)).size !== s.authors.length ||
      (s.lastRun!==undefined && (!s.lastRun || !["running","completed","skipped","paused","error"].includes(s.lastRun.outcome) ||
        [s.lastRun.at,s.lastRun.finishedAt,s.lastRun.processed,s.lastRun.fetched,s.lastRun.saved,s.lastRun.failed,s.lastRun.empty].some(n=>!Number.isSafeInteger(n)||n<0) ||
        (s.lastRun.reason!==null&&(typeof s.lastRun.reason!=="string"||s.lastRun.reason.length>80)))) ||
      s.authors.some(a => !/^\d{2,20}$/.test(a.id) || !/^[a-z0-9_]{1,15}$/i.test(a.username) || typeof a.name !== "string" || a.name.length > 256 ||
        !["S", "A"].includes(a.expectedTier) || !["legacy", "free"].includes(a.source) || typeof a.paused !== "boolean" ||
        [a.addedAt,a.checkedAt,a.nextCheckAt,a.savedTotal].some(n => !Number.isFinite(n) || n < 0) ||
        !validId(a.latestId) || !validId(a.pendingLatestId) || !validId(a.baselineId) ||
        (a.pendingCursor !== null && (typeof a.pendingCursor !== "string" || a.pendingCursor.length > 4096)) ||
        (a.lastError !== null && (typeof a.lastError !== "string" || a.lastError.length > 256)) ||
        (a.initialPending !== undefined && typeof a.initialPending !== "boolean") ||
        (a.initialBaselineId !== undefined && !validId(a.initialBaselineId)) ||
        (a.metrics !== undefined && !validFreeMetrics(a.metrics)))) throw Error();
    return s;
  } catch (e: any) {
    if (e.code === "ENOENT") return freshFreeState();
    throw new FreeCuratedError(503, "本番の無料巡回状態が読み取れません。既存状態を保持して停止しました。");
  }
}
export async function writeScheduledFreeState(s: ScheduledFreeState, directory = serverRegistryDirectory()) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const temp = path.join(directory, `state-${randomBytes(8).toString("hex")}.tmp`);
  try { await fs.writeFile(temp, JSON.stringify(s), { mode: 0o600, flag: "wx" }); await fs.rename(temp, path.join(directory, "state-v1.json")); }
  finally { await fs.rm(temp, { force: true }); }
}
export async function withScheduledFreeState<T>(work: (s: ScheduledFreeState) => Promise<T>, directory = serverRegistryDirectory()) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 }); const lock = path.join(directory, "operation.lock");
  try { await fs.mkdir(lock); } catch (e: any) { if (e.code === "EEXIST") throw new FreeCuratedError(409, "無料巡回・同期が実行中です。完了を待ってください。"); throw e; }
  try { const s = await readScheduledFreeState(directory); return await work(s); }
  finally { await fs.rmdir(lock); }
}
// A stopped free registration stays out of automatic paid collection as well.
export async function freeManagedAuthorIds() { return new Set((await readScheduledFreeState()).authors.map(a => a.id)); }
