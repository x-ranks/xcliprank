// Stale-while-revalidate for one expensive, shared value (the full video index).
// - Fresh entry for the same key: returned as is.
// - Entry too old or key changed, but still within staleMaxMs: the old value is returned immediately and ONE
//   background rebuild starts, so visitors and crawlers never wait for the rebuild.
// - No entry (first start) or entry older than staleMaxMs: the caller waits for a build; concurrent callers share it.
// A failed background rebuild keeps the old value and is not retried more often than retryMs.
export type StaleCacheOptions = { freshMs: number; staleMaxMs: number; retryMs: number; now?: () => number };
export function createStaleCache<T>(options: StaleCacheOptions) {
  const now = options.now ?? Date.now;
  let entry: { builtAt: number; key: string; value: Promise<T> } | null = null;
  let refreshing = false, failedAt = -Infinity;
  function blockingBuild(key: string, build: () => Promise<T>) {
    const value = build();
    const next = { builtAt: now(), key, value };
    entry = next;
    value.catch(() => { if (entry === next) entry = null; });
    return value;
  }
  function backgroundRefresh(key: string, build: () => Promise<T>) {
    if (refreshing || now() - failedAt < options.retryMs) return;
    refreshing = true;
    build().then(
      result => { entry = { builtAt: now(), key, value: Promise.resolve(result) }; },
      () => { failedAt = now(); },
    ).finally(() => { refreshing = false; });
  }
  /** key: what the value depends on (null when it could not be determined right now; the old value is then kept). */
  function get(key: string | null, build: () => Promise<T>): Promise<T> {
    const current = entry, age = current ? now() - current.builtAt : Infinity;
    if (current && age < options.staleMaxMs) {
      if (age < options.freshMs && (key === null || current.key === key)) return current.value;
      if (key !== null) backgroundRefresh(key, build);
      else if (age >= options.freshMs) backgroundRefresh(current.key, build);
      return current.value;
    }
    if (key === null) return Promise.reject(new Error("STALE_CACHE_KEY_UNAVAILABLE"));
    return blockingBuild(key, build);
  }
  return { get, peek: () => entry };
}
