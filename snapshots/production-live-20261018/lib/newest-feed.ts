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

export function buildNewestFeed<T extends Post>(recent: T[], archive: T[], reserved: ReadonlySet<string>, seed: string, reservedMedia: ReadonlySet<string> = new Set()) {
  const used = new Set(reserved), counts = new Map<string, number>();
  const usedMedia = new Set(reservedMedia);
  const selected: (T & { ranking_slot: string; ranking_supplemented: boolean })[] = [];
  function take(pool: T[], slot: string) {
    for (const post of pool) {
      if (selected.length >= NEWEST_TOTAL) break;
      const key = id(post), authorKey = author(post), media = videoIdentity(post);
      if (used.has(key) || media && usedMedia.has(media) || (counts.get(authorKey) ?? 0) >= NEWEST_AUTHOR_LIMIT) continue;
      used.add(key); counts.set(authorKey, (counts.get(authorKey) ?? 0) + 1);
      if (media) usedMedia.add(media);
      selected.push({ ...post, ranking_slot: slot, ranking_supplemented: slot !== "recent" });
    }
  }
  take(recent, "recent");
  const newRecent = selected.length;
  take(archive.filter(p => ["S", "A+", "A"].includes(String(p.adult_tier)))
    .map(post => ({ post, key: randomKey(seed, "newest-archive:" + id(post)) }))
    .sort((a, b) => a.key.localeCompare(b.key)).map(row => row.post), "random_archive");
  const posts: typeof selected = [];
  for (let i = 0; i < selected.length; i += NEWEST_PAGE_SIZE) {
    posts.push(...spreadAuthors(selected.slice(i, i + NEWEST_PAGE_SIZE), seed + ":page:" + i, posts.length ? author(posts[posts.length - 1]) : ""));
  }
  return { posts, newRecent, newArchive: selected.length - newRecent, shortfall: NEWEST_TOTAL - selected.length };
}
