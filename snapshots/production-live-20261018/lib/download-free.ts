import { requiresSafetyReview } from "./adult-score";
import { DownloadError, type DownloadMedia } from "./download-url";
import { isAllowedDownloadUrl } from "./video-download";

export const FREE_PROVIDER = "fxtwitter-v2";
function failure(status: number, code: string, message: string, retryable = false) {
  return Object.assign(new DownloadError(status, `${message}（${code}）`), { code, retryable });
}
export function selectFreeDownloadMedia(body: any, id: string, legacy = false): DownloadMedia[] {
  const post = legacy ? body?.tweet : body?.status;
  if (body?.code !== 200 || !post || (!legacy && (post.type !== "status" || post.provider !== "twitter")) || typeof post.id !== "string" || post.id !== id ||
      !post.author || post.author.protected !== false ||
      post.withheld || post.is_private || post.deleted || post.unavailable || typeof post.text !== "string") {
    throw failure(404, "PUBLIC_POST_UNVERIFIED", "無料取得で公開投稿を確認できません。削除・非公開・取得制限の場合は利用できません。");
  }
  const texts = [post.text, post.raw_text?.text].filter((v): v is string => typeof v === "string");
  if (texts.some(value => {
    const text = value.normalize("NFKC");
    return requiresSafetyReview(text) || /盗撮|無断撮影|リベンジポルノ|児童ポルノ|\b(?:non[- ]?consensual|underage|child porn)\b/i.test(text);
  })) throw new DownloadError(403, "安全性の確認が必要なため、この投稿は保存対象外です。");
  // Only attached media on the requested post; do not traverse quotes or media.external.
  const videos = Array.isArray(post.media?.videos) && post.media.videos.length ? post.media.videos :
    Array.isArray(post.media?.all) ? post.media.all.filter((item: any) => item?.type === "video") : [];
  const seen = new Set<string>();
  return videos.slice(0, 4).flatMap((video: any, index: number) => {
    // publisher identifies the video source and may be present on X-hosted attached media.
    // It is not a signal that the video URL belongs to an external site.
    if (video?.type !== "video") return [];
    const candidates = Array.isArray(video.formats) ? video.formats.filter((v: any) => v?.container === "mp4") : [];
    if (video.format === "video/mp4") candidates.push({ url: video.url, bitrate: 0 });
    const chosen = candidates.filter((v: any) => typeof v?.url === "string" && v.url.length <= 4096 &&
      isAllowedDownloadUrl(v.url) && new URL(v.url).pathname.toLowerCase().endsWith(".mp4"))
      .sort((a: any, b: any) => (Number(b.bitrate) || 0) - (Number(a.bitrate) || 0))[0];
    if (!chosen || seen.has(chosen.url)) return [];
    seen.add(chosen.url);
    return [{ mediaKey: `free-${index}`, url: chosen.url }];
  });
}

export type FreePlaybackMedia = DownloadMedia & { hlsUrl?: string; durationSeconds?: number };

export function selectFreePlaybackMedia(body: any, id: string, legacy = false): FreePlaybackMedia[] {
  const media = selectFreeDownloadMedia(body, id, legacy); // same privacy, safety and native-media checks
  const post = legacy ? body.tweet : body.status;
  const videos = Array.isArray(post.media?.videos) && post.media.videos.length ? post.media.videos :
    Array.isArray(post.media?.all) ? post.media.all.filter((item: any) => item?.type === "video") : [];
  return media.map(item => {
    const index = Number(item.mediaKey.slice(5));
    const video = videos[index];
    const hls = video?.formats?.find((format: any) => format?.container === "m3u8" &&
      typeof format.url === "string" && format.url.length <= 4096 && isAllowedDownloadUrl(format.url) &&
      new URL(format.url).pathname.toLowerCase().endsWith(".m3u8"));
    const duration = video?.duration;
    const durationSeconds = typeof duration === "number" && Number.isFinite(duration) && duration > 0 && duration <= 86400
      ? duration : undefined;
    return { ...item, ...(hls ? { hlsUrl: hls.url } : {}),
      ...(durationSeconds !== undefined ? { durationSeconds } : {}) };
  });
}

async function fetchMetadata(id: string, legacy: boolean, fetcher: typeof fetch, playback = false): Promise<FreePlaybackMedia[]> {
  let response: Response;
  try {
    response = await fetcher(`https://api.fxtwitter.com/${legacy ? "" : "2/"}status/${id}`, {
      headers: { Accept: "application/json", "User-Agent": "Xclip-Download/1.1 (+https://xcliprank.com/download)" },
      redirect: "error", cache: "no-store", signal: AbortSignal.timeout(12000),
    });
  } catch (error: any) {
    const timeout = ["TimeoutError", "AbortError"].includes(error?.name) || error?.cause?.code === "UND_ERR_CONNECT_TIMEOUT";
    throw failure(502, timeout ? "FREE_TIMEOUT" : "FREE_CONNECTION_FAILED",
      timeout ? "無料取得サービスへの接続が時間切れになりました。" : "無料取得サービスに接続できません。通信環境を確認してください。", true);
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw failure(response.status === 429 ? 429 : response.status >= 500 ? 502 : 404, `FREE_HTTP_${response.status}`,
      "無料取得サービスで投稿を取得できません。時間をおいて再試行してください。", response.status >= 500 || response.status === 404);
  }
  if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    await response.body?.cancel(); throw failure(502, "FREE_NOT_JSON", "無料取得サービスの応答を確認できません。", true);
  }
  const maximum = 1024 * 1024;
  if (Number(response.headers.get("content-length")) > maximum) {
    await response.body?.cancel(); throw new DownloadError(502, "無料取得サービスの応答が大きすぎます。");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new DownloadError(502, "無料取得サービスの応答がありません。");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      let part: ReadableStreamReadResult<Uint8Array>;
      try { part = await reader.read(); }
      catch { throw failure(502, "FREE_RESPONSE_INTERRUPTED", "無料取得サービスからの受信が中断しました。", true); }
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maximum) { await reader.cancel(); throw new DownloadError(502, "無料取得サービスの応答が大きすぎます。"); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  let body: any;
  try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw failure(502, "FREE_INVALID_JSON", "無料取得サービスの応答を確認できません。", true); }
  if (body?.code !== 200) throw failure(body?.code === 429 ? 429 : body?.code >= 500 ? 502 : 404,
    `FREE_CODE_${Number.isInteger(body?.code) ? body.code : "UNKNOWN"}`,
    "無料取得サービスで投稿を取得できません。", body?.code >= 500 || body?.code === 404);
  const media = playback ? selectFreePlaybackMedia(body, id, legacy) : selectFreeDownloadMedia(body, id, legacy);
  if (!media.length) throw failure(404, "FREE_NO_VIDEO", "この投稿に無料取得できる動画がありません。", true);
  return media;
}

export async function fetchFreeDownloadMedia(id: string, fetcher: typeof fetch = fetch): Promise<DownloadMedia[]> {
  if (!/^\d{2,20}$/.test(id)) throw new DownloadError(400, "投稿IDが正しくありません。");
  // Only free metadata endpoints on the same fixed provider. Never request CDN bytes here.
  try { return await fetchMetadata(id, false, fetcher); }
  catch (error: any) {
    // Exclusions, unverified public status, private/deleted flags and rate limits never fall back.
    if (!error?.retryable) throw error;
    return fetchMetadata(id, true, fetcher);
  }
}

export async function fetchFreePlaybackMedia(id: string, fetcher: typeof fetch = fetch): Promise<FreePlaybackMedia[]> {
  if (!/^\d{2,20}$/.test(id)) throw new DownloadError(400, "投稿IDが正しくありません。");
  try { return await fetchMetadata(id, false, fetcher, true); }
  catch (error: any) {
    if (!error?.retryable) throw error;
    return fetchMetadata(id, true, fetcher, true);
  }
}
