import { classifyAuthorResponse, authorKey, type AuthorIdentity, type AuthorOutcome } from "./author-status";
import { manualCuratedKeys } from "./curated-removals";
import { readAuthorState, writeAuthorState, authorStateDirectory } from "./author-status-store";
import { DAY, AUTHOR_BATCH_LIMIT, pauseMonitorRequest, FAILURE_COOLDOWN, fetchMonitorJson } from "./availability-policy";

export async function fetchAuthorStatus(key: string, fetcher: typeof fetch = fetch): Promise<{
  outcome: AuthorOutcome; limited?: boolean; retryAfterMs?: number; failed?: boolean;
}> {
  if (!/^(?:id:\d{2,20}|name:[a-z0-9_]{1,15})$/.test(key)) return { outcome: "unknown" };
  const handle = key.startsWith("id:") ? key : key.slice(5);
  const result = await fetchMonitorJson(`/2/profile/${encodeURIComponent(handle)}`, fetcher);
  return { outcome: classifyAuthorResponse(key, result.http, result.body), limited: result.limited,
    retryAfterMs: result.retryAfterMs, failed: result.failed };
}

// The combined CLI holds flock. Confirmed exclusions survive all transient failures.
export async function scanAuthorStatuses(authors: AuthorIdentity[], options: {
  directory?: string; fetcher?: typeof fetch; now?: () => number; maxChecks?: number; pause?: () => Promise<void>;
} = {}) {
  const directory = options.directory ?? authorStateDirectory(), now = options.now ?? Date.now;
  const state = await readAuthorState(directory);
  const keys = new Set([...Object.keys(state.entries), ...authors.map(authorKey).filter((key): key is string => key !== null)]);
  if (keys.size > 5000) throw Error("AUTHOR_MONITOR_TOO_MANY_ACCOUNTS");
  const manual=await manualCuratedKeys();
  const due = [...keys].filter(key => {
    if(manual.has(key))return false;
    const old = state.entries[key];
    return !old || Math.max(old.nextCheckAt, old.checkedAt + DAY) <= now();
  }).sort((a, b) => (state.entries[a]?.checkedAt ?? 0) - (state.entries[b]?.checkedAt ?? 0) || a.localeCompare(b));
  const stats = { checked: 0, suspended: 0, restored: 0, unknown: 0, deferred: due.length, totalAuthors: keys.size,
    paid_x_requests: 0, stopped: false, cooldownUntil: state.cooldownUntil };
  if (state.cooldownUntil > now()) { stats.stopped = true; return stats; }
  const selected = due.slice(0, Math.max(0, Math.min(AUTHOR_BATCH_LIMIT, options.maxChecks ?? AUTHOR_BATCH_LIMIT)));
  let failures = 0;
  for (const key of selected) {
    await (options.pause?.() ?? pauseMonitorRequest());
    const result = await fetchAuthorStatus(key, options.fetcher), time = now(), old = state.entries[key];
    const status = result.outcome === "unknown" ? old?.status ?? "unknown" : result.outcome;
    state.entries[key] = { status, checkedAt: time, confirmedAt: result.outcome === "unknown" ? old?.confirmedAt ?? 0 : time,
      nextCheckAt: time + DAY };
    failures = result.failed ? failures + 1 : 0;
    if (result.limited || failures >= 2) { state.cooldownUntil = time + (result.retryAfterMs ?? FAILURE_COOLDOWN); stats.stopped = true; }
    stats.checked++; stats.deferred--; if (result.outcome === "unknown") stats.unknown++;
    if (status === "suspended" && old?.status !== "suspended") stats.suspended++;
    if (status === "public" && old?.status === "suspended") stats.restored++;
    await writeAuthorState(state, directory);
    if (stats.stopped) break;
  }
  stats.cooldownUntil = state.cooldownUntil;
  return stats;
}
