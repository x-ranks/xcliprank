// IndexNow: tell Bing (and the other engines that share the protocol) which of our own pages are new or changed.
// - The URL list always comes from our own sitemap, so only twizou.net pages can ever be sent.
// - A small state file remembers what was already sent; only new pages and pages whose lastmod moved are sent again.
// - Pages without a lastmod that change all day (top, rankings, rising) are re-sent at most once per Japan-time day.
// - Runs are spaced out, capped, and stop at the first refusal; the state is saved only for batches the service accepted.
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

// The key is public by design: the same text is served at /<key>.txt so the engines can verify ownership.
export const INDEXNOW_KEY = "bdf0f506e6af0e8a3249367f80a50c87";
export const INDEXNOW_HOST = "twizou.net";
export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
export const INDEXNOW_MIN_INTERVAL_MS = 5 * 3600e3;
export const INDEXNOW_BATCH = 1000;
export const INDEXNOW_RUN_LIMIT = 5000;
export const INDEXNOW_STATE_FILE = "indexnow-state.json";

export type SitemapRow = { url: string; lastModified?: string | Date };
export type IndexNowState = { version: 1; lastRunAt: number; urls: Record<string, string> };
export type IndexNowSummary = { skipped?: "interval" | "busy"; planned: number; submitted: number; pending: number; failedStatus?: number };

const ORIGIN = `https://${INDEXNOW_HOST}`;
// Pages that change all day without a lastmod in the sitemap.
const DAILY_PATHS = new Set(["", "/ranking/daily", "/ranking/weekly", "/rising"]);
const jstDay = (time: number) => new Date(time + 9 * 3600000).toISOString().slice(0, 10);

function markOf(row: SitemapRow, now: number): string {
  const value = row.lastModified instanceof Date ? row.lastModified.toISOString() : row.lastModified;
  const time = value ? Date.parse(value) : NaN;
  if (Number.isFinite(time)) return new Date(time).toISOString();
  const rest = row.url.slice(ORIGIN.length).replace(/\/$/, "");
  return DAILY_PATHS.has(rest) ? "day:" + jstDay(now) : "";
}

export function parseState(text: string): IndexNowState {
  const blank: IndexNowState = { version: 1, lastRunAt: 0, urls: {} };
  let raw: any; try { raw = JSON.parse(text); } catch { return blank; }
  if (!raw || raw.version !== 1 || !raw.urls || typeof raw.urls !== "object" || typeof raw.lastRunAt !== "number") return blank;
  const urls: Record<string, string> = {};
  for (const [url, mark] of Object.entries(raw.urls as Record<string, unknown>)) if (typeof mark === "string") urls[url] = mark;
  return { version: 1, lastRunAt: raw.lastRunAt, urls };
}

/** Which sitemap pages still need to be announced. Hub pages first, then videos (newest first), then authors. */
export function planSubmission(rows: SitemapRow[], state: IndexNowState, now: number, limit = INDEXNOW_RUN_LIMIT) {
  const seen = new Set<string>(), due: { url: string; mark: string; group: number; order: string }[] = [];
  for (const row of rows) {
    const url = row.url;
    if (typeof url !== "string" || !(url === ORIGIN || url.startsWith(ORIGIN + "/")) || url.length > 2000 || seen.has(url)) continue;
    seen.add(url);
    const mark = markOf(row, now), known = url in state.urls;
    if (known && (!mark || state.urls[url] === mark)) continue;
    const rest = url.slice(ORIGIN.length), group = rest.startsWith("/p/") ? 1 : rest.startsWith("/accounts/") && rest !== "/accounts" ? 2 : 0;
    due.push({ url, mark, group, order: mark });
  }
  due.sort((a, b) => a.group - b.group || (a.group === 1 ? (a.order < b.order ? 1 : a.order > b.order ? -1 : 0) : 0));
  return { due: due.slice(0, limit), total: due.length };
}

export async function submitBatch(urls: string[], fetchImpl: typeof fetch = fetch): Promise<number> {
  const response = await fetchImpl(INDEXNOW_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ host: INDEXNOW_HOST, key: INDEXNOW_KEY, keyLocation: `${ORIGIN}/${INDEXNOW_KEY}.txt`, urlList: urls }),
    signal: AbortSignal.timeout(20000),
  });
  return response.status;
}

let running = false;
export async function runIndexNow(options: { rows: () => Promise<SitemapRow[]>; dir: string; now?: () => number; fetchImpl?: typeof fetch }): Promise<IndexNowSummary> {
  const now = options.now ?? Date.now, file = join(options.dir, INDEXNOW_STATE_FILE);
  if (running) return { skipped: "busy", planned: 0, submitted: 0, pending: 0 };
  running = true;
  try {
    const state = parseState(await fs.readFile(file, "utf8").catch(() => ""));
    if (now() - state.lastRunAt < INDEXNOW_MIN_INTERVAL_MS) return { skipped: "interval", planned: 0, submitted: 0, pending: 0 };
    const startedAt = now(), plan = planSubmission(await options.rows(), state, startedAt);
    if (!plan.due.length) return { planned: 0, submitted: 0, pending: 0 };
    let submitted = 0, failedStatus: number | undefined;
    for (let i = 0; i < plan.due.length; i += INDEXNOW_BATCH) {
      const batch = plan.due.slice(i, i + INDEXNOW_BATCH);
      let status: number;
      try { status = await submitBatch(batch.map(item => item.url), options.fetchImpl); } catch { status = 0; }
      // 200: accepted. 202: accepted, key check still pending. Anything else: stop and keep the rest for a later run.
      if (status !== 200 && status !== 202) { failedStatus = status; break; }
      for (const item of batch) state.urls[item.url] = item.mark;
      submitted += batch.length;
    }
    state.lastRunAt = startedAt;
    await fs.mkdir(options.dir, { recursive: true });
    const temp = `${file}.${randomUUID()}.tmp`;
    await fs.writeFile(temp, JSON.stringify(state), { mode: 0o600 }); await fs.rename(temp, file);
    return { planned: plan.total, submitted, pending: plan.total - submitted, ...(failedStatus === undefined ? {} : { failedStatus }) };
  } finally { running = false; }
}
