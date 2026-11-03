import { createHash } from "node:crypto";

export const NEWEST_TOTAL = 500;
export const NEWEST_PAGE_SIZE = 50;
export const NEWEST_AUTHOR_LIMIT = 20;
type Post = { x_post_id?: string; id?: string | number; author_id?: string; author_username?: string; adult_tier?: string; created_at: string; [key: string]: unknown };
const id = (p: Post) => String(p.x_post_id ?? p.id);
const author = (p: Post) => String(p.author_id ?? p.author_username ?? id(p));
const randomKey = (seed: string, salt: string) => createHash("sha256").update(seed + ":" + salt).digest("hex");
export function videoIdentity(post: Post): string | null {
  if (typeof post.video_url !== "string") {
    if (typeof post.media_key !== "string" || !post.media_key) return null;
    const media = post.media_key.match(/^(?:\d+_)?(\d+)$/);
    return media ? "x-video:" + media[1] : "media:" + post.media_key;
  }
  try {
    const url = new URL(post.video_url);
    const media = url.pathname.match(/\/(?:ext_tw_video|amplify_video)\/(\d+)\//);
    return media ? "x-video:" + media[1] : url.hostname + url.pathname;
  } catch { return null; }
}

// Keep the 50-item membership chronological; distribute each author's items only within that page.
export function spreadAuthors<T extends Post>(page: T[], seed: string, previousAuthor = ""): T[] {
  const groups = new Map<string, T[]>();
  for (const post of page) {
    const key = author(post);
    const group = groups.get(key) ?? [];
    group.push(post); groups.set(key, group);
  }
  const scheduled = [...groups].flatMap(([key, posts]) => {
    const phase = parseInt(randomKey(seed, key).slice(0, 8), 16) / 0x100000000;
    return posts.map((post, i) => ({ post, author: key, target: (i + phase) / posts.length, tie: randomKey(seed, id(post)) }));
  }).sort((a, b) => a.target - b.target || a.tie.localeCompare(b.tie));
  const result: T[] = [];
  let previous = previousAuthor;
  while (scheduled.length) {
    const alternative = scheduled.findIndex(row => row.author !== previous);
    const [row] = scheduled.splice(alternative < 0 ? 0 : alternative, 1);
    result.push(row.post); previous = row.author;
  }
  return result;
}

export function buildNewestFeed<T extends Post>(recent: T[], archive: T[], reserved: ReadonlySet<string>, seed: string,
  reservedMedia: ReadonlySet<string> = new Set(), registrationTimes: ReadonlyMap<string, number> = new Map(), patrolTimes: ReadonlyMap<string, number> = new Map()) {
  const used = new Set(reserved), counts = new Map<string, number>(), usedMedia = new Set(reservedMedia);
  const archiveIds = new Set(archive.map(id));
  const highTier = (post: T) => ["S", "A+", "A"].includes(String(post.adult_tier));
  const tierOrder: Record<string, number> = { S: 0, "A+": 1, A: 2 };
  const latest = (a: T, b: T) => Date.parse(b.created_at) - Date.parse(a.created_at) || id(b).localeCompare(id(a));
  const all = [...new Map([...recent, ...archive].map(post => [id(post), post])).values()];
  const registration = all.filter(post => registrationTimes.has(id(post)) && highTier(post))
    .sort((a, b) => (tierOrder[String(a.adult_tier)] ?? 9) - (tierOrder[String(b.adult_tier)] ?? 9) ||
      (registrationTimes.get(id(b)) ?? 0) - (registrationTimes.get(id(a)) ?? 0) || latest(a, b));
  const patrol = recent.filter(post => patrolTimes.has(id(post)) && !registrationTimes.has(id(post)))
    .sort((a, b) => (patrolTimes.get(id(b)) ?? 0) - (patrolTimes.get(id(a)) ?? 0) || latest(a, b));
  const chronological = [...recent].sort(latest);
  const evergreen = archive.filter(highTier);
  const featured = [...evergreen].sort((a, b) => (tierOrder[String(a.adult_tier)] ?? 9) - (tierOrder[String(b.adult_tier)] ?? 9) || latest(a, b));
  const filler = evergreen.map(post => ({ post, key: randomKey(seed, "newest-archive:" + id(post)) }))
    .sort((a, b) => a.key.localeCompare(b.key)).map(row => row.post);
  const posts: (T & { ranking_slot: string; ranking_supplemented: boolean })[] = [];
  let priorityCount = 0;
  for (let pageNumber = 0; pageNumber < NEWEST_TOTAL / NEWEST_PAGE_SIZE; pageNumber++) {
    const page: typeof posts = [], pageCounts = new Map<string, number>();
    function take(pool: T[], max = 1) {
      let taken = 0;
      for (const post of pool) {
        if (page.length >= NEWEST_PAGE_SIZE || taken >= max) break;
        const key = id(post), authorKey = author(post), media = videoIdentity(post);
        if (used.has(key) || media && usedMedia.has(media) || (counts.get(authorKey) ?? 0) >= NEWEST_AUTHOR_LIMIT ||
          (pageCounts.get(authorKey) ?? 0) >= 3) continue;
        const old = archiveIds.has(key);
        used.add(key); if (media) usedMedia.add(media);
        counts.set(authorKey, (counts.get(authorKey) ?? 0) + 1);
        pageCounts.set(authorKey, (pageCounts.get(authorKey) ?? 0) + 1);
        page.push({ ...post, ranking_slot: old ? "random_archive" : "recent", ranking_supplemented: old });
        taken++;
      }
      return taken;
    }
    // The first five available positions go to high-tier videos from fresh author/URL registration.
    if (pageNumber === 0) priorityCount = take(registration, 5);
    // Even a full 24-hour feed keeps one older high-tier item on each page when one is available.
    if (!page.some(post => archiveIds.has(id(post)))) take(featured);
    take(patrol, NEWEST_PAGE_SIZE - page.length);
    take(chronological, NEWEST_PAGE_SIZE - page.length);
    take(filler, NEWEST_PAGE_SIZE - page.length);
    if (!page.length) break;
    posts.push(...page);
  }
  const newRecent = posts.filter(post => !post.ranking_supplemented).length;
  return { posts, newRecent, newArchive: posts.length - newRecent, shortfall: NEWEST_TOTAL - posts.length, priorityCount };
}
