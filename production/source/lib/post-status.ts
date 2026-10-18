import { authorKey, type AuthorIdentity, isSuspendedAuthor } from "./author-status";
export type PostIdentity = AuthorIdentity & { x_post_id?: unknown };
export type PostOutcome = "public" | "missing" | "hidden" | "unknown";
export function postKey(post: PostIdentity) {
  const id = String(post.x_post_id ?? ""); return /^\d{2,20}$/.test(id) ? `post:${id}` : null;
}
export function isUnavailablePost(post: PostIdentity, blocked: ReadonlySet<string>) {
  const key = postKey(post); return (key !== null && blocked.has(key)) || isSuspendedAuthor(post, blocked);
}
export function classifyPostResponse(post: PostIdentity, http: number, body: any): PostOutcome {
  if (!postKey(post) || ![200, 401, 403, 404].includes(http) || !body || ![200, 401, 403, 404].includes(body.code)) return "unknown";
  const id = String(post.x_post_id), status = body.status;
  if ((body.id !== undefined && String(body.id) !== id) || (status?.id !== undefined && String(status.id) !== id)) return "unknown";
  // Inspect only the requested status; deleted quotes/replies must not hide their parent.
  if (status?.type === "tombstone") {
    if (status.id !== id || status.provider !== "twitter") return "unknown";
    return status.reason === "deleted" ? "missing" : ["private", "blocked", "suspended", "unavailable"].includes(status.reason) ? "hidden" : "unknown";
  }
  if (body.code === 404 && body.message === "NOT_FOUND" && !status) return "missing";
  if (http !== 200 || body.code !== 200 || (body.message !== undefined && body.message !== "OK") || status?.type !== "status" || status.provider !== "twitter" ||
      status.id !== id || typeof status.author?.protected !== "boolean" || typeof status.text !== "string") return "unknown";
  const returned = authorKey({ author_id: status.author.id, author_username: status.author.screen_name }), expected = authorKey(post);
  if (!expected || !(expected.startsWith("id:") ? returned === expected :
    String(status.author.screen_name ?? "").toLowerCase() === expected.slice(5))) return "unknown";
  if (status.deleted === true) return "missing";
  if (status.author.protected || status.unavailable === true || status.withheld === true || status.is_private === true) return "hidden";
  // A public text response alone cannot prove that the original video is available.
  const videos = Array.isArray(status.media?.videos) ? status.media.videos : status.media?.all;
  if (!Array.isArray(videos)) return "unknown";
  const playableUrl = (value: unknown) => {
    if (typeof value !== "string" || value.length > 4096) return false;
    try { const url = new URL(value); return url.protocol === "https:" && url.hostname === "video.twimg.com" &&
      !url.username && !url.password && !url.port && /\.(?:mp4|m3u8)$/i.test(url.pathname); } catch { return false; }
  };
  return videos.some((video: any) => video?.type === "video" && (playableUrl(video.url) ||
    Array.isArray(video.formats) && video.formats.some((format: any) => playableUrl(format?.url)))) ? "public" : "hidden";
}
