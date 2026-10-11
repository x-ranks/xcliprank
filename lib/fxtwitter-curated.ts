export class FreeCuratedError extends Error {
  constructor(public status: number, message: string, public retryAfterMs?: number, public providerFailure = false) { super(message); }
}
export type FreeAuthor = { id: string; username: string; name: string; expectedTier: "S" | "A" };
// Own normalized metadata contract; independent of paid collector exports.
export type FreeCandidate = {
  x_post_id: string; author_id: string | null; author_username: string | null; author_name: string | null;
  text: string; possibly_sensitive: boolean; created_at: string; x_url: string;
  media_key: string | null; media_type: string | null; preview_image_url: string | null;
  video_url: string | null; video_bitrate: number | null;
  views: number; likes: number; reposts: number; replies: number; quotes: number; bookmarks: number;
  durationSeconds: number | null; videoCount: number;
};

export function normalizeFreeUsername(value: unknown): string {
  if (typeof value !== "string" || value.length > 256) throw new FreeCuratedError(400, "投稿者名が正しくありません。");
  let name = value.trim();
  if (/^https?:\/\//i.test(name)) {
    let url: URL;
    try { url = new URL(name); } catch { throw new FreeCuratedError(400, "URLが正しくありません。"); }
    if (url.protocol !== "https:" || !["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(url.hostname) ||
        url.username || url.password || url.port || !/^\/[a-z0-9_]{1,15}\/?$/i.test(url.pathname)) {
      throw new FreeCuratedError(400, "XのプロフィールURLを入力してください。");
    }
    name = url.pathname.replace(/^\//, "").replace(/\/$/, "");
  }
  name = name.replace(/^@/, "");
  if (!/^[a-z0-9_]{1,15}$/i.test(name) || ["home", "search", "i", "intent", "explore"].includes(name.toLowerCase())) {
    throw new FreeCuratedError(400, "Xの投稿者名を入力してください。");
  }
  return name;
}

async function freeJson(path: string, fetcher: typeof fetch, signal?: AbortSignal) {
  let response: Response;
  try {
    response = await fetcher(`https://api.fxtwitter.com/2/${path}`, {
      cache: "no-store", redirect: "error", credentials: "omit", referrerPolicy: "no-referrer",
      headers: { Accept: "application/json", "User-Agent": "Xclip-Free-Curated/1.0 (+https://xcliprank.com)" },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000),
    });
  } catch { throw new FreeCuratedError(502, "無料サービスへの接続が失敗・中断しました。有料APIへ切り替えません。", undefined, true); }
  if (response.status === 429) {
    const value = response.headers.get("retry-after");
    const delay = value && /^\d+$/.test(value) ? Number(value) * 1000 : value ? Date.parse(value) - Date.now() : 0;
    await response.body?.cancel(); throw new FreeCuratedError(429, "無料サービスの取得制限です。最低6時間待機します。",
      Math.min(7 * 86400000, Math.max(6 * 3600000, Number.isFinite(delay) ? delay : 0)));
  }
  if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    await response.body?.cancel(); throw new FreeCuratedError(502, "無料サービスの応答形式を確認できません。", undefined, true);
  }
  const maximum = 4 * 1024 * 1024;
  if (Number(response.headers.get("content-length")) > maximum) {
    await response.body?.cancel(); throw new FreeCuratedError(502, "無料サービスの応答が大きすぎます。", undefined, true);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new FreeCuratedError(502, "無料サービスから応答がありません。", undefined, true);
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > maximum) { await reader.cancel(); throw new FreeCuratedError(502, "応答サイズ上限を超えました。", undefined, true); }
      chunks.push(part.value);
    }
  } catch (error) {
    if (error instanceof FreeCuratedError) throw error;
    throw new FreeCuratedError(502, "無料サービスからの受信が中断しました。", undefined, true);
  } finally { reader.releaseLock(); }
  let body: any;
  try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new FreeCuratedError(502, "無料サービスのJSONを確認できません。", undefined, true); }
  if (!response.ok || body?.code !== 200) {
    const limited = response.status === 429 || body?.code === 429;
    throw new FreeCuratedError(limited ? 429 : 502, body?.reason === "suspended"
      ? "この投稿者は凍結されています。登録・取得できません。"
      : limited ? "無料サービスの取得制限です。5分以上あけて再試行してください。"
      : "公開情報を取得できません。削除・非公開・サービス側の制限を確認してください。", limited ? 6 * 3600000 : undefined, response.status >= 500 || body?.code >= 500);
  }
  return body;
}

export async function fetchFreeProfile(input: string, expectedTier: "S" | "A", fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<FreeAuthor> {
  const idRequest = /^id:\d{2,20}$/.test(input);
  const handle = idRequest ? input : normalizeFreeUsername(input);
  const body = await freeJson(`profile/${encodeURIComponent(handle)}`, fetcher, signal), user = body.user;
  if (body.reason || user?.type !== "profile" || !/^\d{2,20}$/.test(String(user.id ?? "")) ||
      typeof user.screen_name !== "string" || !/^[a-z0-9_]{1,15}$/i.test(user.screen_name) || user.protected !== false ||
      (idRequest ? String(user.id) !== input.slice(3) : user.screen_name.toLowerCase() !== handle.toLowerCase())) {
    throw new FreeCuratedError(502, "同一投稿者の公開プロフィールを確認できません。");
  }
  return { id: String(user.id), username: user.screen_name, name: String(user.name ?? user.screen_name).slice(0, 256), expectedTier };
}

const countValue = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.min(Math.floor(value), Number.MAX_SAFE_INTEGER) : 0;
function cdnUrl(value: unknown, thumbnail = false): string | null {
  if (typeof value !== "string" || value.length > 4096) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === (thumbnail ? "pbs.twimg.com" : "video.twimg.com") &&
      !url.username && !url.password && !url.port ? value : null;
  } catch { return null; }
}

export function parseFreeMediaPage(body: any, author: FreeAuthor) {
  if (body?.code !== 200 || !Array.isArray(body.results) || body.results.length > 100) {
    throw new FreeCuratedError(502, "投稿一覧の形式を確認できません。");
  }
  const posts: FreeCandidate[] = []; let skipped = 0, multipleVideoPosts = 0;
  const seen = new Set<string>();
  for (const post of body.results) {
    if (post?.type !== "status" || post.provider !== "twitter" || !/^\d{2,20}$/.test(String(post.id ?? "")) ||
        String(post.author?.id ?? "") !== author.id || post.author?.protected !== false ||
        post.withheld || post.is_private || post.deleted || post.unavailable || post.reposted_by || post.replying_to ||
        typeof post.text !== "string" || post.text.length > 100000 || typeof post.possibly_sensitive !== "boolean") { skipped++; continue; }
    const created = typeof post.created_timestamp === "number" ? post.created_timestamp * 1000 : Date.parse(post.created_at);
    if (!Number.isFinite(created) || created < 0 || created > Date.now() + 300000) { skipped++; continue; }
    // Only native media attached to this post. Quotes, GIFs and external embeds are excluded.
    const videos = (Array.isArray(post.media?.videos) ? post.media.videos : Array.isArray(post.media?.all) ? post.media.all : [])
      .filter((v: any) => v?.type === "video").slice(0, 4);
    const mapped = videos.flatMap((v: any) => {
      const candidates = Array.isArray(v.formats) ? v.formats.filter((f: any) => f.container === "mp4") : [];
      if (v.format === "video/mp4") candidates.push({ url: v.url, bitrate: 0 });
      const best = candidates.filter((f: any) => cdnUrl(f.url) && new URL(f.url).pathname.toLowerCase().endsWith(".mp4"))
        .sort((a: any, b: any) => countValue(b.bitrate) - countValue(a.bitrate))[0];
      return best ? [{ video: v, url: best.url as string, bitrate: countValue(best.bitrate) }] : [];
    });
    if (!mapped.length || seen.has(post.id)) { skipped++; continue; }
    seen.add(post.id); if (mapped.length > 1) multipleVideoPosts++;
    // Existing posts schema has one video per post: use the first attached playable video.
    const selected = mapped[0], duration = selected.video.duration;
    posts.push({ x_post_id: String(post.id), author_id: author.id, author_username: author.username, author_name: author.name,
      text: post.text, possibly_sensitive: post.possibly_sensitive, created_at: new Date(created).toISOString(),
      x_url: `https://x.com/${author.username}/status/${post.id}`, media_key: selected.video.id ? String(selected.video.id).slice(0, 128) : null,
      media_type: "video", preview_image_url: cdnUrl(selected.video.thumbnail_url, true), video_url: selected.url,
      video_bitrate: selected.bitrate, views: countValue(post.views), likes: countValue(post.likes), reposts: countValue(post.reposts),
      replies: countValue(post.replies), quotes: countValue(post.quotes), bookmarks: countValue(post.bookmarks),
      durationSeconds: typeof duration === "number" && Number.isFinite(duration) && duration > 0 && duration <= 86400 ? duration : null,
      videoCount: mapped.length });
  }
  const cursor = body.cursor?.bottom;
  if (cursor != null && (typeof cursor !== "string" || cursor.length > 4096)) throw new FreeCuratedError(502, "ページ送り情報が不正です。");
  const timelineIds = [...new Set<string>(body.results.filter((p: any) => p?.type === "status" && p.provider === "twitter" &&
    String(p.author?.id ?? "") === author.id && /^\d{2,20}$/.test(String(p.id ?? ""))).map((p: any) => String(p.id)))];
  return { posts, timelineIds, rawCount: body.results.length, skipped, multipleVideoPosts, nextCursor: cursor || null };
}

export async function fetchFreeMediaPage(author: FreeAuthor, count: number, cursor: string | null, fetcher: typeof fetch = fetch, signal?: AbortSignal, maximumPosts = count) {
  if (!Number.isInteger(maximumPosts) || maximumPosts < 1 || maximumPosts > count || ![20, 50, 100].includes(count) || !/^\d{2,20}$/.test(author.id) || (cursor !== null && (typeof cursor !== "string" || cursor.length > 4096))) {
    throw new FreeCuratedError(400, "取得件数・投稿者ID・ページ情報が正しくありません。");
  }
  // Persist the feed with its cursor: old in-progress media pages keep their original feed.
  const prefix = "xclip-statuses-v1:";
  const statuses = cursor === null || cursor.startsWith(prefix);
  const providerCursor = cursor?.startsWith(prefix) ? cursor.slice(prefix.length) : cursor;
  if (cursor?.startsWith(prefix) && !providerCursor) throw new FreeCuratedError(400, "ページ送り情報が不正です。");
  const query = new URLSearchParams({ count: String(count) }); if (providerCursor) query.set("cursor", providerCursor);
  const body=await freeJson(`profile/${encodeURIComponent(`id:${author.id}`)}/${statuses ? "statuses" : "media"}?${query}`, fetcher, signal);
  if (statuses && body.cursor?.bottom) {
    if (typeof body.cursor.bottom !== "string" || body.cursor.bottom.length > 4096-prefix.length) throw new FreeCuratedError(502, "ページ送り情報が不正です。");
    body.cursor = {...body.cursor, bottom: prefix + body.cursor.bottom};
  }
  if(!Array.isArray(body.results)||body.results.length>100)return parseFreeMediaPage(body,author);
  return parseFreeMediaPage({...body,results:body.results.slice(0,maximumPosts)},author);
}
