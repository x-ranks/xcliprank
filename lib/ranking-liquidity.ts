export const LIQUIDITY_WINDOW_MS = 5 * 60 * 1000;
export const NEW_ARCHIVE_MIN = 50;
export const NEW_ARCHIVE_MAX = 100;
export const DAILY_ARCHIVE_SLOTS = 85;
export const DAILY_TOTAL = 100;
const AUTHOR_LIMIT = 20;
type Post = { x_post_id?: string; id?: string | number; author_id?: string; author_username?: string; adult_tier?: string; created_at: string; [key: string]: unknown };
const id = (post: Post) => String(post.x_post_id ?? post.id);
const author = (post: Post) => String(post.author_id ?? post.author_username ?? id(post));
function unique<T extends Post>(posts: T[]) {
  const seen = new Set<string>();
  return posts.filter(post => { const key = id(post); if (seen.has(key)) return false; seen.add(key); return true; });
}
function hash(value: string) {
  let result = 2166136261;
  for (let i = 0; i < value.length; i++) { result ^= value.charCodeAt(i); result = Math.imul(result, 16777619); }
  return result >>> 0;
}
export function liquidityClock(now = Date.now()) {
  const snapshot = Math.floor(now / LIQUIDITY_WINDOW_MS) * LIQUIDITY_WINDOW_MS;
  return { snapshot, since: new Date(snapshot - 86400000).toISOString(), seed: new Date(snapshot + 9 * 3600000).toISOString().slice(0, 10) };
}
// Both tabs share one plan. Never independently randomize their archive pools.
export function buildLiquidRankings<T extends Post>(recentNewest: T[], archiveRanked: T[], since: string, seed: string) {
  const cutoff = Date.parse(since);
  const recent = unique(recentNewest.filter(p => Date.parse(p.created_at) >= cutoff));
  const archive = unique(archiveRanked.filter(p => Date.parse(p.created_at) < cutoff && ['S', 'A+', 'A'].includes(String(p.adult_tier))));
  const used = new Set<string>();
  function take(pool: T[], count: number, existing: T[] = []) {
    const counts = new Map<string, number>();
    for (const p of existing) counts.set(author(p), (counts.get(author(p)) ?? 0) + 1);
    const result: T[] = [];
    for (const p of pool) {
      if (result.length >= count) break;
      if (used.has(id(p)) || (counts.get(author(p)) ?? 0) >= AUTHOR_LIMIT) continue;
      result.push(p); used.add(id(p)); counts.set(author(p), (counts.get(author(p)) ?? 0) + 1);
    }
    return result;
  }
  const newest = take(recent, 100);
  // Reserve the 85 quality-ranked archive slots before the random archive draw.
  const dailyArchive = take(archive, DAILY_ARCHIVE_SLOTS);
  const randomArchive = [...archive].sort((a, b) => hash(seed + ':' + id(a)) - hash(seed + ':' + id(b)) || id(a).localeCompare(id(b)));
  const archiveTarget = Math.max(NEW_ARCHIVE_MIN, Math.min(NEW_ARCHIVE_MAX, 100 - newest.length));
  const newArchive = take(randomArchive, archiveTarget, newest);
  const dailyRecent = take(recent, DAILY_TOTAL - dailyArchive.length, dailyArchive);
  const dailyExtraArchive = take(archive, DAILY_TOTAL - dailyArchive.length - dailyRecent.length, [...dailyArchive, ...dailyRecent]);
  const mark = (p: T, slot: string) => ({ ...p, ranking_slot: slot, ranking_supplemented: slot !== 'recent' });
  const trending = [...newest.map(p => mark(p, 'recent')), ...newArchive.map(p => mark(p, 'random_archive'))];
  const daily = [...dailyRecent.map(p => mark(p, 'recent')), ...dailyArchive.map(p => mark(p, 'fixed_archive')), ...dailyExtraArchive.map(p => mark(p, 'extra_archive'))];
  return { trending, daily, metrics: { newRecent: newest.length, newArchive: newArchive.length, newArchiveTarget: archiveTarget, dailyRecent: dailyRecent.length, dailyFixedArchive: dailyArchive.length, dailyExtraArchive: dailyExtraArchive.length, trendingShortfall: Math.max(0, 100 - trending.length), dailyShortfall: Math.max(0, DAILY_TOTAL - daily.length), dailyArchiveShortfall: Math.max(0, DAILY_ARCHIVE_SLOTS - dailyArchive.length), newArchiveShortfall: Math.max(0, archiveTarget - newArchive.length), overlap: 0, seed } };
}
