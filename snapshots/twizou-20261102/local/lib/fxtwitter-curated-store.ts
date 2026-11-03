import { FREE_CURATED_AUTHOR_LIMIT } from "./free-curated-limits";
import type { RegistrationJob } from "./free-curated-registration";
import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { FreeCuratedError, type FreeAuthor, type FreeCandidate } from "./fxtwitter-curated";

export type FreeRegistration = FreeAuthor & { paused: boolean; addedAt: string; checkedAt: string | null;
  nextCursor: string | null; candidates: FreeCandidate[]; rawCount: number; skipped: number; savedTotal: number;
  lastSavedAt: string | null; error: string | null; registration?: RegistrationJob };
export type FreeRegistry = { version: 1; cooldownUntil: number; authors: FreeRegistration[] };
export const registryDirectory = () => path.join(process.cwd(), ".local-admin", "fxtwitter-curated-v1");

export async function readFreeRegistry(directory = registryDirectory()): Promise<FreeRegistry> {
  let text: string;
  try { text = await fs.readFile(path.join(directory, "state.json"), "utf8"); }
  catch (e: any) { if (e.code === "ENOENT") return { version: 1, cooldownUntil: 0, authors: [] }; throw e; }
  try {
    if (Buffer.byteLength(text) > 30 * 1024 * 1024) throw Error();
    const data = JSON.parse(text) as FreeRegistry;
    if (data.version !== 1 || !Number.isFinite(data.cooldownUntil) || data.cooldownUntil < 0 || !Array.isArray(data.authors) || data.authors.length > FREE_CURATED_AUTHOR_LIMIT ||
        data.authors.some(a => !/^\d{2,20}$/.test(a.id) || !/^[a-z0-9_]{1,15}$/i.test(a.username) ||
          !["S", "A"].includes(a.expectedTier) || typeof a.paused !== "boolean" || !Array.isArray(a.candidates) || a.candidates.length > 100 ||
          typeof a.name !== "string" || a.name.length > 256 || !Number.isFinite(a.savedTotal) || a.savedTotal < 0 ||
          (a.checkedAt !== null && !Number.isFinite(Date.parse(a.checkedAt))) ||
          (a.nextCursor !== null && (typeof a.nextCursor !== "string" || a.nextCursor.length > 4096)) ||
          a.candidates.some(p => p.author_id !== a.id || !/^\d{2,20}$/.test(p.x_post_id) || typeof p.text !== "string" || p.text.length > 100000 ||
            typeof p.possibly_sensitive !== "boolean" || !Number.isFinite(Date.parse(p.created_at)) ||
            typeof p.video_url !== "string" || !/^https:\/\/video\.twimg\.com\//.test(p.video_url) || p.video_url.length > 4096 ||
            typeof p.videoCount !== "number" || p.videoCount < 1 || p.videoCount > 4 ||
            [p.views,p.likes,p.reposts,p.replies,p.quotes,p.bookmarks].some(n => !Number.isFinite(n) || n < 0))) ||
        data.authors.some(a => a.registration !== undefined && (!a.registration ||
          ![100,200,300].includes(a.registration.requested) || !["sync","fetch","publish","completed"].includes(a.registration.phase) ||
          [a.registration.scanned,a.registration.pages,a.registration.fetched,a.registration.saved,a.registration.excluded,a.registration.duplicates].some(n=>!Number.isSafeInteger(n)||n<0) ||
          (a.registration.sessionId!==undefined&&(typeof a.registration.sessionId!=="string"||!/^[a-f0-9]{32}$/.test(a.registration.sessionId))) ||
          (a.registration.patrolReady!==undefined&&typeof a.registration.patrolReady!=="boolean") || (a.registration.patrolReady===true&&!a.registration.initialLatestId) ||
          (a.registration.historyOutcome!==undefined&&!["complete","partial"].includes(a.registration.historyOutcome)) ||
          (a.registration.finishReason!==undefined&&!["page_limit","cursor_stalled","empty_limit"].includes(a.registration.finishReason)) ||
          [a.registration.emptyPages??0,a.registration.emptyStreak??0].some(n=>!Number.isSafeInteger(n)||n<0||n>30) ||
          a.registration.scanned>a.registration.requested || a.registration.pages>30 || !Array.isArray(a.registration.cursors) || a.registration.cursors.length>30 ||
          a.registration.cursors.some(c=>typeof c!=="string"||c.length>4096) || !Array.isArray(a.registration.postIds) || a.registration.postIds.length>300 ||
          (a.registration.initialLatestId!==undefined&&a.registration.initialLatestId!==null&&!/^\d{2,20}$/.test(a.registration.initialLatestId)) ||
          a.registration.postIds.some(id=>!/^\d{2,20}$/.test(id)) ||
          (a.registration.cursor!==null&&(typeof a.registration.cursor!=="string"||a.registration.cursor.length>4096)) ||
          (a.registration.error!==null&&typeof a.registration.error!=="string"))) ||
        new Set(data.authors.map(a => a.id)).size !== data.authors.length) throw Error();
    return data;
  } catch { throw new FreeCuratedError(503, "無料投稿者の状態ファイルを確認できません。上書きせず停止しました。"); }
}

export async function writeFreeRegistry(state: FreeRegistry, directory = registryDirectory()) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const tmp = path.join(directory, `state-${randomBytes(6).toString("hex")}.tmp`);
  try { await fs.writeFile(tmp, JSON.stringify(state), { mode: 0o600 }); await fs.rename(tmp, path.join(directory, "state.json")); }
  finally { await fs.rm(tmp, { force: true }); }
}

export async function withFreeRegistry<T>(work: (state: FreeRegistry) => Promise<T>, directory = registryDirectory()) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const lock = path.join(directory, "operation.lock");
  try { await fs.mkdir(lock); }
  catch (e: any) { if (e.code === "EEXIST") throw new FreeCuratedError(409, "別の無料取得操作が実行中です。完了を待ってください。"); throw e; }
  try {
    const state = await readFreeRegistry(directory);
    try { return await work(state); }
    finally { await writeFreeRegistry(state, directory); }
  } finally { await fs.rmdir(lock); }
}
