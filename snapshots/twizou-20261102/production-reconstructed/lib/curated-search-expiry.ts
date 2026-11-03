import type { CuratedPendingSearch } from './curated-search-state';
const DAY = 86400000;
const MARGIN = 5 * 60000;
const EPOCH = 1288834974657n;
const OVERLAP = 15 * 60000;
export type CuratedExpiryEvent = {
  action: 'clamp' | 'restart'; recordedAt: string;
  skippedFrom: string; skippedUntil: string; originalUntilId: string;
  originalEndTime: string; nextStartTime: string; nextEndTime: string;
};
export type CuratedExpiryAudit = { totalEvents: number; events: CuratedExpiryEvent[] };
function boundary(ms: number) { return ((BigInt(ms) - EPOCH) << 22n).toString(); }
function validId(value: string) { return /^\d+$/.test(value) && BigInt(value) > 0n; }
// Pure housekeeping: no API requests, successful-cursor updates, or post writes.
export function planCuratedSearchExpiry(pending: CuratedPendingSearch | null, audit: CuratedExpiryAudit | null | undefined, now = Date.now()) {
  if (!pending) return { pending, audit: audit ?? null, event: null };
  const start = Date.parse(pending.startTime), end = Date.parse(pending.endTime);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end || end > now || !validId(pending.untilId) || (pending.latestPostId !== null && !validId(pending.latestPostId))) throw new Error('Invalid stored pending search; expiry cleanup stopped.');
  const earliest = now - 7 * DAY + MARGIN;
  // Trigger only within the original one-minute expiry guard; leave four minutes of hysteresis.
  if (start >= now - 7 * DAY + 60000) return { pending, audit: audit ?? null, event: null };
  if (audit && (!Number.isSafeInteger(audit.totalEvents) || audit.totalEvents < 0 || !Array.isArray(audit.events))) throw new Error('Invalid stored expiry audit; cleanup stopped.');
  const until = BigInt(pending.untilId);
  const untilTime = Number((until >> 22n) + EPOCH);
  if (untilTime > end + 1000) throw new Error("Invalid pending ID upper bound; expiry cleanup stopped.");
  const canResume = end > earliest && until > BigInt(boundary(earliest));
  const newEnd = now - 10000;
  const next: CuratedPendingSearch = canResume
    ? { ...pending, startTime: new Date(earliest).toISOString() }
    : { startTime: new Date(Math.max(earliest, Math.min(end, newEnd) - OVERLAP)).toISOString(), endTime: new Date(newEnd).toISOString(), untilId: boundary(newEnd), latestPostId: pending.latestPostId };
  const event: CuratedExpiryEvent = {
    action: canResume ? 'clamp' : 'restart', recordedAt: new Date(now).toISOString(),
    skippedFrom: pending.startTime,
    skippedUntil: new Date(Math.min(earliest, end, untilTime)).toISOString(),
    originalUntilId: pending.untilId, originalEndTime: pending.endTime,
    nextStartTime: next.startTime, nextEndTime: next.endTime
  };
  if (Date.parse(event.skippedUntil) < start) throw new Error('Invalid pending ID/time bounds; expiry cleanup stopped.');
  return { pending: next, event, audit: { totalEvents: (audit?.totalEvents ?? 0) + 1, events: [...(audit?.events ?? []), event].slice(-20) } satisfies CuratedExpiryAudit };
}
export async function persistCuratedSearchExpiry(db: any, author: { x_author_id: string; curated_pending_search: CuratedPendingSearch | null; curated_search_expiry?: CuratedExpiryAudit | null }, plan: ReturnType<typeof planCuratedSearchExpiry>) {
  if (!plan.event) return;
  let query = db.from('authors').update({
    curated_pending_search: plan.pending, curated_search_expiry: plan.audit,
    curated_last_error: 'Expired search range recorded; valid pages queued for the next regular collection.'
  }).eq('x_author_id', author.x_author_id).eq('curated_pending_search', JSON.stringify(author.curated_pending_search));
  query = author.curated_search_expiry == null ? query.is('curated_search_expiry', null) : query.eq('curated_search_expiry', JSON.stringify(author.curated_search_expiry));
  const result = await query.select('x_author_id');
  if (result.error) throw new Error('Expiry state write failed; no X request made: ' + result.error.message);
  if (result.data?.length !== 1) throw new Error('Expiry state changed concurrently; no X request made.');
}
