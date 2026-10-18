import { authorKey, isSuspendedAuthor } from "./author-status";
import { manualCuratedKeys } from "./curated-removals";
import { authorStateDirectory, readAuthorState } from "./author-status-store";
import { scanAuthorStatuses } from "./author-status-scan";
import { classifyPostResponse, postKey, type PostIdentity } from "./post-status";
import { entryPost, readPostState, writePostState, POST_STATE_LIMIT, type PostEntry } from "./post-status-store";
import { DAY, BATCH_INTERVAL, POST_BATCH_LIMIT, pauseMonitorRequest, FAILURE_COOLDOWN, fetchMonitorJson } from "./availability-policy";

// CLI owns flock. Batch reservations are durable before DB reads or external requests.
export async function scanAvailabilityStatuses(loadPage: (cursor: string | null) => Promise<PostIdentity[]>, options: {
  directory?: string; fetcher?: typeof fetch; now?: () => number; pause?: () => Promise<void>;
} = {}) {
  const directory = options.directory ?? authorStateDirectory(), now = options.now ?? Date.now;
  const state = await readPostState(directory), authorsBefore = await readAuthorState(directory), started = now();
  const stats = { feature: "availability_monitor", skipped: false, author_checked: 0, suspended: 0, author_restored: 0,
    post_checked: 0, post_missing: 0, post_hidden: 0, post_restored: 0, post_unknown: 0, stopped: false,
    cycle_complete: false, next_batch_at: state.nextBatchAt, paid_x_requests: 0 };
  if (Math.max(state.nextBatchAt, state.cooldownUntil, authorsBefore.cooldownUntil) > started) { stats.skipped = true; return stats; }
  // Five minutes of tolerance for Cron start jitter; an immediate repeat still has no DB/API calls.
  state.nextBatchAt = started + BATCH_INTERVAL - 5 * 60000;
  await writePostState(state, directory); stats.next_batch_at = state.nextBatchAt;
  const rotationReady = !state.cycleCompletedAt || started >= state.cycleStartedAt + DAY;
  const rows = rotationReady ? await loadPage(state.cursor) : [];
  if (!Array.isArray(rows) || rows.length > 200 || rows.some(row => !postKey(row)) ||
      new Set(rows.map(row => String(row.x_post_id))).size !== rows.length) throw Error("MONITOR_PAGE_INVALID");
  // DB order/lt use the same column semantics (text or bigint); do not reinterpret its ordering here.
  if (rotationReady && state.cursor === null) { state.cycleStartedAt = started; state.cycleCompletedAt = 0; }
  const manual=await manualCuratedKeys();
  const authorStats = await scanAuthorStatuses(rows.filter(p=>!isSuspendedAuthor(p,manual)), { ...options, directory });
  stats.author_checked = authorStats.checked; stats.suspended = authorStats.suspended; stats.author_restored = authorStats.restored;
  if (authorStats.stopped) { state.cooldownUntil = Math.max(state.cooldownUntil, authorStats.cooldownUntil);
    await writePostState(state, directory); stats.stopped = true; return stats; }
  const authorState = await readAuthorState(directory), blockedAuthors = new Set(Object.keys(authorState.entries)
    .filter(key => authorState.entries[key].status === "suspended"));
  for(const key of manual)blockedAuthors.add(key);
  // Reserve up to five of the twenty requests for missing/blocked posts; fresh rotation retains capacity.
  const retryIds = Object.keys(state.entries).filter(id => {
    const entry = state.entries[id]; return (entry.blocked || entry.missingSince > 0) && entry.nextCheckAt <= started &&
      !(entry.authorKey && blockedAuthors.has(entry.authorKey));
  }).sort((a, b) => state.entries[a].checkedAt - state.entries[b].checkedAt || a.localeCompare(b)).slice(0, 5);
  const seen = new Set<string>(), confirm: string[] = []; let failures = 0, publicVerified = false;
  const pause = options.pause ?? pauseMonitorRequest;
  async function check(post: PostIdentity) {
    const id = String(post.x_post_id), old = state.entries[id];
    if (seen.has(id) || (old && Math.max(old.nextCheckAt, old.checkedAt + DAY) > now()) || isSuspendedAuthor(post, blockedAuthors)) return false;
    if (!old && Object.keys(state.entries).length >= POST_STATE_LIMIT) throw Error("POST_MONITOR_CAPACITY; confirmed exclusions preserved");
    seen.add(id);
    const time = now();
    const entry: PostEntry = { authorKey: authorKey(post), checkedAt: time, nextCheckAt: time + (old?.blocked ? 7 * DAY : DAY),
      missingSince: old?.missingSince ?? 0, lastMissingAt: old?.lastMissingAt ?? 0, blocked: old?.blocked ?? false };
    state.entries[id] = entry; await writePostState(state, directory); // a crash must not cause an immediate repeat
    await pause();
    const reply = await fetchMonitorJson(`/2/status/${id}`, options.fetcher), outcome = classifyPostResponse(post, reply.http, reply.body);
    stats.post_checked++;
    if (outcome === "public") {
      publicVerified = true; entry.missingSince = 0; entry.lastMissingAt = 0;
      if (entry.blocked) stats.post_restored++;
      entry.blocked = false; entry.nextCheckAt = now() + DAY;
    } else if (outcome === "missing" || outcome === "hidden") {
      stats.post_missing++;
      entry.missingSince = old?.missingSince || time; entry.lastMissingAt = time;
      if (!entry.blocked && old?.missingSince && old.lastMissingAt > 0 && time - old.lastMissingAt >= DAY) confirm.push(id);
    } else stats.post_unknown++;
    // Individual unknown/private/deleted posts must not halt the whole rotation.
    failures = reply.failed ? failures + 1 : 0;
    if (reply.limited || failures >= 2) {
      state.cooldownUntil = now() + (reply.retryAfterMs ?? FAILURE_COOLDOWN); stats.stopped = true;
    }
    await writePostState(state, directory);
    return true;
  }
  for (const id of retryIds) { await check(entryPost(id, state.entries[id])); if (stats.stopped) break; }
  let visited = 0;
  if (!stats.stopped && rotationReady) {
    for (const post of rows) {
      if (stats.post_checked >= POST_BATCH_LIMIT) break;
      await check(post); state.cursor = String(post.x_post_id); visited++;
      await writePostState(state, directory);
      if (stats.stopped) break;
    }
    if (!stats.stopped && visited === rows.length && rows.length < 200) {
      state.cursor = null; state.cycleCompletedAt = now(); stats.cycle_complete = true;
    }
  }
  // A successful status response in this batch guards against provider-wide false NOT_FOUND responses.
  // On all-missing/unknown batches, retain candidates without adding any new exclusion.
  if (publicVerified && !stats.stopped) for (const id of confirm) {
    const entry = state.entries[id]; entry.blocked = true; entry.nextCheckAt = now() + 7 * DAY; stats.post_hidden++;
  }
  for (const [id, entry] of Object.entries(state.entries)) {
    if (!entry.blocked && !entry.missingSince && entry.checkedAt < started - 35 * DAY) delete state.entries[id];
  }
  await writePostState(state, directory);
  return stats;
}
