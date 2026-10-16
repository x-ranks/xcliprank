import { createHmac, timingSafeEqual } from "node:crypto";
import { canDownloadPost, isAllowedDownloadUrl, type DownloadPost } from "./video-download";

export class DownloadError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function parsePostUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 2048) return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.port ||
      !["x.com", "www.x.com", "mobile.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com"].includes(url.hostname)) return null;
    return url.pathname.match(/^\/(?:[a-zA-Z0-9_]{1,15}\/status|i\/(?:web\/)?status)\/(\d{1,25})(?:\/(?:video|photo)\/[1-4])?\/?$/)?.[1] ?? null;
  } catch { return null; }
}
export type DownloadMedia = { mediaKey: string; url: string };
export function selectDownloadMedia(body: any, id: string): DownloadMedia[] {
  const post = body?.data;
  if (!post || String(post.id) !== id || post.withheld || body.errors?.length) throw new DownloadError(404, "この公開投稿を取得できません。削除・非公開の場合は利用できません。");
  const keys: string[] = Array.isArray(post.attachments?.media_keys) ? post.attachments.media_keys.slice(0, 4) : [];
  return keys.flatMap((key: string) => {
    const media = body.includes?.media?.find((m: any) => m.media_key === key && m.type === "video");
    const variant = media?.variants?.filter((v: any) => v.content_type === "video/mp4" && typeof v.url === "string" && isAllowedDownloadUrl(v.url))
      .sort((a: any, b: any) => (Number(b.bit_rate) || 0) - (Number(a.bit_rate) || 0))[0];
    return variant ? [{ mediaKey: key, url: variant.url }] : [];
  });
}
type Ticket = { id: string; url: string; expires: number };
export function signDownloadTicket(id: string, url: string, secret: string, now = Date.now()) {
  if (!/^\d{1,25}$/.test(id) || !isAllowedDownloadUrl(url)) throw new DownloadError(400, "保存情報が正しくありません。");
  const data = Buffer.from(JSON.stringify({ id, url, expires: now + 10 * 60 * 1000 })).toString("base64url");
  return `${data}.${createHmac("sha256", secret).update(data).digest("base64url")}`;
}
export function verifyDownloadTicket(token: string, id: string, secret: string, now = Date.now()): Ticket | null {
  if (token.length > 8192) return null;
  const [data, signature, extra] = token.split(".");
  if (!data || !signature || extra) return null;
  const expected = createHmac("sha256", secret).update(data).digest();
  const given = Buffer.from(signature, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(expected, given)) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString());
    if (payload.id !== id || !Number.isFinite(payload.expires) || payload.expires <= now || payload.expires > now + 10 * 60 * 1000 ||
      typeof payload.url !== "string" || !isAllowedDownloadUrl(payload.url)) return null;
    return payload;
  } catch { return null; }
}
export type ResolveDependencies = {
  findPost: (id: string) => Promise<DownloadPost | null>;
  lookup: (id: string) => Promise<DownloadMedia[]>;
  secret: () => Promise<string>;
};
export async function resolvePostUrl(raw: unknown, deps: ResolveDependencies) {
  const id = parsePostUrl(raw);
  if (!id) throw new DownloadError(400, "XまたはTwitterの投稿URLを入力してください。アカウントURLや短縮URLは利用できません。");
  const stored = await deps.findPost(id);
  if (stored) {
    if (!canDownloadPost(stored)) throw new DownloadError(403, "この投稿は除外・非表示・要確認、または保存対象外です。");
    return { id, source: "stored" as const, videos: [{ token: null as string | null }] };
  }
  const media = await deps.lookup(id);
  if (!media.length) throw new DownloadError(404, "この投稿に保存可能な動画がありません。");
  const secret = await deps.secret();
  return { id, source: "lookup" as const, videos: media.map(item => ({ token: signDownloadTicket(id, item.url, secret) })) };
}
export function postForTicket(stored: DownloadPost | null, token: string, id: string, secret: string): DownloadPost | null {
  // Existing moderation decisions always take precedence over a signed ticket.
  if (stored && !canDownloadPost(stored)) return null;
  const ticket = verifyDownloadTicket(token, id, secret);
  return ticket ? { video_url: ticket.url, is_visible: true, moderation_blocked: false, review_required: false,
    content_category: "PASS", adult_tier: "C", manual_tier: null } : null;
}
