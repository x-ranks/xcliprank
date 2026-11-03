export class FreeCuratedError extends Error {
  constructor(public status: number, message: string, public retryAfterMs?: number, public providerFailure = false, public recoveryAction?: "sync") { super(message); }
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

export function parseFreePostUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 512) throw new FreeCuratedError(400, "Xの投稿URLを入力してください。");
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new FreeCuratedError(400, "Xの投稿URLが正しくありません。"); }
  if (url.protocol !== "https:" || !["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(url.hostname) ||
      url.username || url.password || url.port || url.hash) throw new FreeCuratedError(400, "Xの投稿URLが正しくありません。");
  const match = url.pathname.match(/^\/(?:[a-z0-9_]{1,15}|i(?:\/web)?)\/status\/(\d{2,20})(?:\/video\/\d+)?\/?$/i);
  if (!match) throw new FreeCuratedError(400, "Xの投稿URLが正しくありません。");
  return match[1];
}

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
      headers: { Accept: "application/json", "User-Agent": "Xclip-Free-Curated/1.0 (+https://twizou.net)" },
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

// Timeline rows include reposts and pinned duplicates; neither is a new own post.
// Unknown/foreign rows remain untrusted. Never use their IDs as a collection boundary.
export function classifyFreeTimeline(results: any[], author: FreeAuthor, allowReplyContext = false, allowReferences = false) {
  const ids: string[] = [], seen = new Map<string, string>();
  const counts = { own: 0, reposts: 0, duplicates: 0, context: 0, type: 0, provider: 0, id: 0, author: 0, foreign: 0, repostIdentity: 0, conflict: 0 };
  // A foreign reply/parent is context only if an explicit same-page reply-ID chain connects it to an own post.
  // Handles, appearance order, and timestamps alone are never identity evidence.
  const graph=new Map<string,any>(),conflicts=new Set<string>(),connected=new Set<string>();
  if(allowReplyContext){
    for(const p of results){
      if(p?.type!=="status"||p.provider!=="twitter"||typeof p.id!=="string"||!/^\d{2,20}$/.test(p.id)||
        typeof p.author?.id!=="string"||!/^\d{2,20}$/.test(p.author.id)||p.reposted_by!=null)continue;
      if(graph.has(p.id)&&JSON.stringify(graph.get(p.id))!==JSON.stringify(p))conflicts.add(p.id);
      else graph.set(p.id,p);
    }
    for(const id of conflicts)graph.delete(id);
    for(const [id,p]of graph)if(p.author.id===author.id)connected.add(id);
    let changed=true;
    while(changed){changed=false;for(const[id,p]of graph){
      const parent=p.replying_to?.status;
      if(typeof parent!=="string"||!graph.has(parent))continue;
      if(connected.has(id)&&!connected.has(parent)){connected.add(parent);changed=true;}
      if(connected.has(parent)&&!connected.has(id)){connected.add(id);changed=true;}
    }}
  }
  for (const p of results) {
    if (p?.type !== "status") { counts.type++; continue; }
    if (p.provider !== "twitter") { counts.provider++; continue; }
    if (typeof p.id !== "string" || !/^\d{2,20}$/.test(p.id)) { counts.id++; continue; }
    if (typeof p.author?.id !== "string" || !/^\d{2,20}$/.test(p.author.id)) { counts.author++; continue; }
    if (p.reposted_by != null) {
      if (typeof p.reposted_by !== "object" || p.reposted_by.id !== author.id) { counts.repostIdentity++; continue; }
      counts.reposts++; continue;
    }
    if (p.author.id !== author.id) {
      const quoted=allowReferences&&results.some(root=>root?.type==="status"&&root.provider==="twitter"&&root.author?.id===author.id&&root.author.protected===false&&!root.reposted_by&&root.quote?.type==="status"&&root.quote.provider==="twitter"&&root.quote.id===p.id&&root.quote.author?.id===p.author.id);
      if((allowReplyContext&&connected.has(p.id))||quoted)counts.context++;else counts.foreign++; continue;
    }
    // Exact duplicate content is safe to deduplicate. Conflicting rows for one ID are not.
    const fingerprint = JSON.stringify(p), previous = seen.get(p.id);
    if (previous !== undefined) {
      if (previous === fingerprint) counts.duplicates++; else counts.conflict++;
      continue;
    }
    seen.set(p.id, fingerprint); ids.push(p.id); counts.own++;
  }
  // The scheduled collector requests replies and references together. A provider
  // may include unrelated but well-formed foreign rows beside the author's own
  // posts. They are never candidates or watermark IDs; do not discard the own
  // posts solely because those unrelated rows were present. Registration and
  // ordinary imports keep the stricter contract.
  const unlinkedForeignSafe = allowReplyContext && allowReferences && counts.own > 0;
  const trusted = ![counts.type, counts.provider, counts.id, counts.author, counts.repostIdentity, counts.conflict].some(Boolean) &&
    (counts.foreign === 0 || unlinkedForeignSafe);
  return { ids, counts, trusted };
}

export function parseFreeMediaPage(body: any, author: FreeAuthor, includeReplies = false, includeReferences = false) {
  if (body?.code !== 200 || !Array.isArray(body.results) || body.results.length > 100) {
    throw new FreeCuratedError(502, "投稿一覧の形式を確認できません。");
  }
  const posts: FreeCandidate[] = []; let skipped = 0, multipleVideoPosts = 0;
  const seen = new Set<string>();
  for (const post of body.results) {
    if (post?.type !== "status" || post.provider !== "twitter" || !/^\d{2,20}$/.test(String(post.id ?? "")) ||
        String(post.author?.id ?? "") !== author.id || post.author?.protected !== false ||
        post.withheld || post.is_private || post.deleted || post.unavailable || post.reposted_by || (!includeReplies && post.replying_to) ||
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
  return { posts, timelineIds, referencedPosts: includeReferences ? parseFreeReferencedPosts(body.results, author, new Set(posts.map(p=>p.x_post_id)), 100-posts.length) : [], timeline: classifyFreeTimeline(body.results, author, includeReplies, includeReferences), rawCount: body.results.length, skipped, multipleVideoPosts, nextCursor: cursor || null };
}

export async function fetchFreePostUrl(value: unknown, expectedTier: "S" | "A", fetcher: typeof fetch = fetch, signal?: AbortSignal) {
  const id = parseFreePostUrl(value);
  const body = await freeJson(`status/${id}`, fetcher, signal), post = body.status;
  if (post?.type !== "status" || post.provider !== "twitter" || String(post.id) !== id ||
      post.author?.type !== "profile" || !/^\d{2,20}$/.test(String(post.author.id ?? "")) ||
      typeof post.author.screen_name !== "string" || !/^[a-z0-9_]{1,15}$/i.test(post.author.screen_name) ||
      post.author.protected !== false) throw new FreeCuratedError(422, "公開中の投稿者と投稿を確認できません。");
  const author: FreeAuthor = { id: String(post.author.id), username: post.author.screen_name,
    name: String(post.author.name ?? post.author.screen_name).slice(0, 256), expectedTier };
  const parsed = parseFreeMediaPage({ code: 200, results: [post] }, author, true);
  if (parsed.posts.length !== 1) throw new FreeCuratedError(422, "この投稿には掲載できる直接動画がありません。画像・GIF・引用先の動画は対象外です。");
  return { author, candidate: parsed.posts[0] };
}

export async function fetchFreeMediaPage(author: FreeAuthor, count: number, cursor: string | null, fetcher: typeof fetch = fetch, signal?: AbortSignal, maximumPosts = count, includeReplies = false, includeReferences = false) {
  if (!Number.isInteger(maximumPosts) || maximumPosts < 1 || maximumPosts > count || ![20, 50, 100].includes(count) || !/^\d{2,20}$/.test(author.id) || (cursor !== null && (typeof cursor !== "string" || cursor.length > 4096))) {
    throw new FreeCuratedError(400, "取得件数・投稿者ID・ページ情報が正しくありません。");
  }
  // Persist the feed with its cursor: old in-progress media pages keep their original feed.
  const prefix = "xclip-statuses-v1:";
  const repliesPrefix = "xclip-statuses-replies-v1:";
  const statuses = cursor === null || cursor.startsWith(prefix) || cursor.startsWith(repliesPrefix);
  // A cursor belongs to the original feed. Do not change with_replies midway through an old window.
  const replyFeed = statuses && (cursor === null ? includeReplies : cursor.startsWith(repliesPrefix));
  const activePrefix = replyFeed ? repliesPrefix : prefix;
  const providerCursor = cursor !== null && statuses ? cursor.slice(activePrefix.length) : cursor;
  if (cursor !== null && statuses && !providerCursor) throw new FreeCuratedError(400, "ページ送り情報が不正です。");
  const query = new URLSearchParams({ count: String(count) }); if (providerCursor) query.set("cursor", providerCursor);
  if (replyFeed) query.set("with_replies", "1");
  const body=await freeJson(`profile/${encodeURIComponent(`id:${author.id}`)}/${statuses ? "statuses" : "media"}?${query}`, fetcher, signal);
  if (statuses && body.cursor?.bottom) {
    if (typeof body.cursor.bottom !== "string" || body.cursor.bottom.length > 4096-activePrefix.length) throw new FreeCuratedError(502, "ページ送り情報が不正です。");
    body.cursor = {...body.cursor, bottom: activePrefix + body.cursor.bottom};
  }
  if(!Array.isArray(body.results)||body.results.length>100)return parseFreeMediaPage(body,author,includeReplies,includeReferences);
  return parseFreeMediaPage({...body,results:body.results.slice(0,maximumPosts)},author,includeReplies,includeReferences);
}

export type FreeReferencedPost={kind:"quote"|"repost";viaPostId:string;viaText:string;author:FreeAuthor;candidate:FreeCandidate};
// Called only by the scheduled, server-fetched timeline. Client-supplied candidates
// cannot opt into this path. Never follows arbitrary text URLs or external cards.
export function parseFreeReferencedPosts(results:any[],curator:FreeAuthor,seen=new Set<string>(),limit=100):FreeReferencedPost[]{
 const out:FreeReferencedPost[]=[];
 for(const root of results){
  if(out.length>=limit)break;
  if(root?.type!=="status"||root.provider!=="twitter"||typeof root.id!=="string"||!/^\d{2,20}$/.test(root.id)||root.deleted||root.withheld||root.unavailable||root.is_private)continue;
  const repost=root.reposted_by?.id===curator.id,own=root.author?.id===curator.id&&root.author.protected===false&&!root.reposted_by;
  if(!repost&&!own)continue;
  if(own&&(seen.has(root.id)||typeof root.text!=="string"||root.text.length>100000||typeof root.possibly_sensitive!=="boolean"))continue;
  const source=repost?root:root.quote,kind=repost?"repost":"quote";
  if(source?.type!=="status"||source.provider!=="twitter"||typeof source.id!=="string"||!/^\d{2,20}$/.test(source.id)||source.author?.protected!==false||typeof source.author?.id!=="string"||!/^\d{2,20}$/.test(source.author.id)||typeof source.author.screen_name!=="string"||!/^[a-z0-9_]{1,15}$/i.test(source.author.screen_name)||seen.has(source.id))continue;
  const author:FreeAuthor={id:source.author.id,username:source.author.screen_name,name:String(source.author.name??source.author.screen_name).slice(0,256),expectedTier:curator.expectedTier};
  // Strip only the verified repost envelope; the original public/native-media
  // validation is identical to ordinary candidates. Quote tombstones never pass.
  const parsed=parseFreeMediaPage({code:200,results:[{...source,reposted_by:null}]},author,true,false);
  if(parsed.posts.length!==1)continue;
  seen.add(source.id);out.push({kind,viaPostId:root.id,viaText:own?root.text:"",author,candidate:parsed.posts[0]});
 }
 return out;
}
