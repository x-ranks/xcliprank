import { promises as fs } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import { DownloadError, type DownloadMedia } from "./download-url";
import { isAllowedDownloadUrl } from "./video-download";

const DAILY_LIMIT = 200;
import { fetchFreeDownloadMedia, FREE_PROVIDER } from "./download-free";
const TTL = 10 * 60 * 1000;
const stateDirectory = () => process.env.XCLIP_DOWNLOAD_STATE_DIR || path.join(homedir(), ".xclip-download");
export async function downloadSecret() {
  const directory = stateDirectory();
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, "secret");
  try { await fs.writeFile(file, randomBytes(32).toString("hex"), { flag: "wx", mode: 0o600 }); }
  catch (error: any) { if (error.code !== "EEXIST") throw error; }
  const secret = await fs.readFile(file, "utf8");
  if (!/^[a-f0-9]{64}$/.test(secret)) throw new DownloadError(503, "保存機能の設定を確認中です。時間をおいて再試行してください。");
  return secret;
}
type Entry = { expires: number; media?: DownloadMedia[]; error?: string; status?: number };
type State = { provider: string; day: string; used: number; cache: Record<string, Entry> };

export async function lookupPublicVideo(id: string, options: { directory?: string; fetcher?: typeof fetch; now?: () => number } = {}) {
  if (!/^\d{2,20}$/.test(id)) throw new DownloadError(400, "投稿IDが正しくありません。");
  const directory = options.directory ?? stateDirectory();
  const now = options.now ?? Date.now;
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  // Separate state and lock from the former paid lookup budget/cache.
  const lock = path.join(directory, "lookup-free-v2.lock");
  let locked = false;
  for (let attempt = 0; attempt < 600; attempt++) {
    try { await fs.mkdir(lock, { mode: 0o700 }); locked = true; break; }
    catch (error: any) {
      if (error.code !== "EEXIST") throw error;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  // Do not steal a lock from another process. After an abrupt crash, clear it only while dev server is stopped.
  if (!locked) throw new DownloadError(503, "無料取得処理が混み合っています。少し待って再試行してください。（FREE_LOCK_WAIT）");
  const file = path.join(directory, "lookup-free-v2.json");
  async function save(state: State) {
    const temporary = file + "." + randomBytes(8).toString("hex") + ".tmp";
    try {
      await fs.writeFile(temporary, JSON.stringify(state), { mode: 0o600, flag: "wx" });
      await fs.rename(temporary, file);
    } finally { await fs.unlink(temporary).catch(() => {}); }
  }
  try {
    const day = new Date(now() + 9 * 3600000).toISOString().slice(0, 10);
    let state: State = { provider: FREE_PROVIDER, day, used: 0, cache: {} };
    try { state = JSON.parse(await fs.readFile(file, "utf8")); }
    catch (error: any) { if (error.code !== "ENOENT") throw new DownloadError(503, "無料取得制限の状態を確認中です。"); }
    if (!state || state.provider !== FREE_PROVIDER || !state.cache || typeof state.cache !== "object" || Array.isArray(state.cache) ||
        !Number.isInteger(state.used) || state.used < 0 || state.used > DAILY_LIMIT || !/^\d{4}-\d{2}-\d{2}$/.test(state.day) ||
        Object.keys(state.cache).length > DAILY_LIMIT * 2) throw new DownloadError(503, "無料取得制限の状態を確認中です。");
    for (const [key, entry] of Object.entries(state.cache)) {
      if (!/^\d{2,20}$/.test(key) || !entry || !Number.isFinite(entry.expires) ||
          (entry.media && (!Array.isArray(entry.media) || entry.media.length > 4 || entry.media.some(m =>
            typeof m?.mediaKey !== "string" || typeof m?.url !== "string" || !isAllowedDownloadUrl(m.url)))) ||
          (entry.error && (typeof entry.error !== "string" || !Number.isInteger(entry.status) || entry.status! < 400 || entry.status! > 599))) {
        throw new DownloadError(503, "無料取得キャッシュの状態を確認中です。");
      }
      if (entry.expires <= now()) delete state.cache[key];
    }
    if (state.day !== day) { state.day = day; state.used = 0; }
    const cached = state.cache[id];
    if (cached) {
      if (cached.error) throw new DownloadError(cached.status ?? 404, cached.error);
      return cached.media ?? [];
    }
    if (state.used >= DAILY_LIMIT) throw new DownloadError(429, "本日の無料新規取得は上限に達しました。翌日またはランキング内の保存機能をご利用ください。");
    state.used++; await save(state);
    const started = Date.now(); let outcome = "error";
    try {
      const media = await fetchFreeDownloadMedia(id, options.fetcher);
      state.cache[id] = { expires: now() + TTL, media }; await save(state);
      outcome = "ok"; return media;
    } catch (error) {
      const failure = error instanceof DownloadError ? error : new DownloadError(502,
        "無料取得に失敗しました。時間をおいて再試行してください。有料取得への切り替えは行いません。");
      state.cache[id] = { expires: now() + 60000, error: failure.message, status: failure.status }; await save(state);
      throw failure;
    } finally {
      // Free lookups never write to paid X API usage logs or any database.
      if (!options.directory) console.info(JSON.stringify({ feature: "video_download", provider: FREE_PROVIDER,
        outcome, duration_ms: Date.now() - started, paid_x_requests: 0 }));
    }
  } finally { await fs.rmdir(lock).catch(() => {}); }
}
