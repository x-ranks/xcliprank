// The standalone HTTP adapter installs this request-scoped context. No shared
// mutable per-user state is used when Next runs without the adapter.
export function recordPublicRankingFreshness(response: Response) {
  const storage = (globalThis as any)[Symbol.for("twizou.public-response-context.v1")];
  const current = storage?.getStore?.();
  if (!current || !response.ok) return;
  const age = Number(response.headers.get("X-Twizou-Ranking-Cache-Age-Ms"));
  current.rankingSeen = true;
  current.freshUntil = Math.min(current.freshUntil, performance.now() + Math.max(0, 30000 - (Number.isFinite(age) ? age : 30000)));
}
