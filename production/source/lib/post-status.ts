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
  // FxTwitter (2026-11) returns {"status":null,"thread":null,"author":null,"code":404} with no message for a missing post.
  if (body.code === 404 && !status && (body.message === undefined || body.message === "NOT_FOUND")) return "missing";
  // 401 with no status body: the owner restricted/protected the account. Still needs the usual two separated confirmations.
  if (http === 401 && body.code === 401 && !status) return "hidden";
  if (http !== 200 || body.code !== 200 || (body.message !== undefined && body.message !== "OK") || status?.type !== "status" || status.provider !== "twitter" ||
      status.id !== id || typeof status.author?.protected !== "boolean" || typeof status.text !== "string") return "unknown";
  const returned = authorKey({ author_id: status.author.id, author_username: status.author.screen_name }), expected = authorKey(post);
  if (!expected || !(expected.startsWith("id:") ? returned === expected :
    String(status.author.screen_name ?? "").toLowerCase() === expected.slice(5))) return "unknown";
  if (status.deleted === true) return "missing";
  if (status.author.protected || status.unavailable === true || status.withheld === true || status.is_private === true) return "hidden";
  // A public text response alone cannot prove that the original video is available.
  const videos = Array.isArray(status.media?.videos) ? status.media.videos : status.media?.all;
  // No media at all (e.g. a quote whose video belonged to a since-deleted account; verified on X 2026-11-14): nothing to play.
  if (!Array.isArray(videos)) return status.media == null ? "hidden" : "unknown";
  const playableUrl = (value: unknown) => {
    if (typeof value !== "string" || value.length > 4096) return false;
    try { const url = new URL(value); return url.protocol === "https:" && url.hostname === "video.twimg.com" &&
      !url.username && !url.password && !url.port && /\.(?:mp4|m3u8)$/i.test(url.pathname); } catch { return false; }
  };
  return videos.some((video: any) => video?.type === "video" && (playableUrl(video.url) ||
    Array.isArray(video.formats) && video.formats.some((format: any) => playableUrl(format?.url)))) ? "public" : "hidden";
}

// Diagnostic only: why classifyPostResponse said "unknown". Never changes a decision.
export function explainUnknownPost(post: PostIdentity, http: number, body: any): string {
  if (!postKey(post)) return "bad_post_id";
  if (![200, 401, 403, 404].includes(http) || !body || ![200, 401, 403, 404].includes(body.code)) return "bad_http_or_body";
  const id = String(post.x_post_id), status = body.status;
  if ((body.id !== undefined && String(body.id) !== id) || (status?.id !== undefined && String(status.id) !== id)) return "id_mismatch";
  if (status?.type === "tombstone") {
    if (status.id !== id || status.provider !== "twitter") return "tombstone_other_provider";
    const reason = String(status.reason ?? "");
    return /^[a-z_]{1,20}$/.test(reason) ? "tombstone_" + reason : "tombstone_other";
  }
  if (body.code === 404 && !status) return body.message === undefined ? "not_found_no_message" : "not_found_other_message";
  if (http === 401 || body.code === 401) return "unauthorized_401";
  if (http === 403 || body.code === 403) return "forbidden_403";
  if (http !== 200 || body.code !== 200) return "http_code_mismatch";
  if (body.message !== undefined && body.message !== "OK") return "message_not_ok";
  if (status?.type !== "status" || status.provider !== "twitter" || status.id !== id || typeof status.author?.protected !== "boolean" || typeof status.text !== "string") return "status_shape";
  const returned = authorKey({ author_id: status.author.id, author_username: status.author.screen_name }), expected = authorKey(post);
  if (!expected || !(expected.startsWith("id:") ? returned === expected : String(status.author.screen_name ?? "").toLowerCase() === expected.slice(5))) return "author_mismatch";
  const videos = Array.isArray(status.media?.videos) ? status.media.videos : status.media?.all;
  if (!Array.isArray(videos)) return status.media == null ? "no_media" : "media_shape";
  return "other";
}
