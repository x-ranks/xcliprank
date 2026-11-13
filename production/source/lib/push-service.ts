/** Subscription validation and the once-a-day digest. Storage, feed lookup and sending are injected so tests need no network. */
import { allowedPushEndpoint, validSubscriptionKeys, type PushSubscriptionKeys, type VapidConfig } from "./web-push";

export const PUSH_MAX_FOLLOWS = 30;
export const PUSH_MAX_SUBSCRIPTIONS = 50000;
export const PUSH_MESSAGE = { title: "twizou", body: "フォロー中の投稿者に新着があります", url: "/following?src=push" } as const;
const ACCOUNT_KEY = /^(?:[a-z0-9_]{1,15}|id-[A-Za-z0-9_-]{1,64})$/;

export type PushRow = PushSubscriptionKeys & { id: number; follows: string[]; notifiedThrough: string };
export type PushStore = {
  count(): Promise<number>;
  upsert(row: PushSubscriptionKeys & { follows: string[] }): Promise<void>;
  remove(endpoint: string): Promise<void>;
  removeIds(ids: number[]): Promise<void>;
  page(afterId: number, limit: number): Promise<PushRow[]>;
  markChecked(ids: number[], through: string): Promise<void>;
  markSent(ids: number[], through: string): Promise<void>;
  markFailed(ids: number[]): Promise<void>;
};

export function parseSubscription(value: unknown): (PushSubscriptionKeys & { follows: string[] }) | null {
  if (!value || typeof value !== "object") return null;
  const v = value as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown }; follows?: unknown };
  if (!allowedPushEndpoint(v.endpoint) || !validSubscriptionKeys(v.keys?.p256dh, v.keys?.auth)) return null;
  if (!Array.isArray(v.follows) || v.follows.length > PUSH_MAX_FOLLOWS || v.follows.some(key => typeof key !== "string" || !ACCOUNT_KEY.test(key))) return null;
  return { endpoint: v.endpoint, p256dh: v.keys!.p256dh as string, auth: v.keys!.auth as string, follows: [...new Set(v.follows as string[])] };
}
export const parseEndpoint = (value: unknown): string | null => value && typeof value === "object" && allowedPushEndpoint((value as { endpoint?: unknown }).endpoint) ? (value as { endpoint: string }).endpoint : null;

export async function subscribe(store: PushStore, value: unknown): Promise<"ok" | "invalid" | "full"> {
  const row = parseSubscription(value); if (!row) return "invalid";
  if (await store.count() >= PUSH_MAX_SUBSCRIPTIONS) return "full";
  await store.upsert(row); return "ok";
}

export type DigestDeps = {
  store: PushStore;
  feed: (keys: string[]) => Promise<{ videos: { createdAt: string | null }[]; failedKeys?: string[] }>;
  send: (subscription: PushSubscriptionKeys, message: { title: string; body: string; url: string }, vapid: VapidConfig) => Promise<number>;
  vapid: VapidConfig;
  now?: () => number;
};
export type DigestSummary = { checked: number; sent: number; removed: number; failed: number; quiet: number };

/**
 * For each subscription: send one plain notification when any followed author posted after the last check.
 * The check time only moves forward after a successful send or when there was nothing to send, so a failed send is retried next run.
 */
export async function runDigest({ store, feed, send, vapid, now = Date.now }: DigestDeps): Promise<DigestSummary> {
  const startedAt = now(), through = new Date(startedAt).toISOString(), summary: DigestSummary = { checked: 0, sent: 0, removed: 0, failed: 0, quiet: 0 };
  let after = 0;
  for (let pageNumber = 0; pageNumber < 500; pageNumber++) {
    const rows = await store.page(after, 200); if (!rows.length) break;
    after = rows[rows.length - 1].id;
    const quiet: number[] = [], sent: number[] = [], gone: number[] = [], failed: number[] = [];
    for (const row of rows) {
      summary.checked++;
      let hasNew = false;
      if (row.follows.length) {
        try {
          const since = Date.parse(row.notifiedThrough);
          const result = await feed(row.follows);
          // Authors the feed could not read are not evidence of "nothing new": keep the check time and try again next run.
          if (result.failedKeys?.length) { failed.push(row.id); summary.failed++; continue; }
          hasNew = result.videos.some(video => { const t = video.createdAt ? Date.parse(video.createdAt) : NaN; return Number.isFinite(t) && t > since && t <= startedAt; });
        } catch { failed.push(row.id); summary.failed++; continue; }
      }
      if (!hasNew) { quiet.push(row.id); summary.quiet++; continue; }
      const status = await send(row, PUSH_MESSAGE, vapid);
      if (status >= 200 && status < 300) { sent.push(row.id); summary.sent++; }
      else if (status === 404 || status === 410) { gone.push(row.id); summary.removed++; }
      else { failed.push(row.id); summary.failed++; }
    }
    if (quiet.length) await store.markChecked(quiet, through);
    if (sent.length) await store.markSent(sent, through);
    if (gone.length) await store.removeIds(gone);
    if (failed.length) await store.markFailed(failed);
  }
  return summary;
}
