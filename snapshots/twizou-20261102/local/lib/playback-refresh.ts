import { canDownloadPost, type DownloadPost } from "./video-download";
import { directPlaybackUrl } from "./browser-direct-playback";
import { DownloadError, type DownloadMedia } from "./download-url";

export async function refreshPlaybackSources(id: string, deps: {
  findPost: (id: string) => Promise<DownloadPost | null>;
  lookup: (id: string) => Promise<Array<DownloadMedia & { hlsUrl?: string }>>;
}): Promise<{ url: string; hlsUrl?: string }> {
  if (!/^\d{2,20}$/.test(id)) throw new DownloadError(400, "投稿IDを確認してください。（PLAYBACK_INVALID_ID）");
  const post = await deps.findPost(id);
  if (!canDownloadPost(post)) throw new DownloadError(404, "非公開・除外対象の投稿は再生できません。（PLAYBACK_EXCLUDED）");
  const media = await deps.lookup(id);
  const path = new URL(post!.video_url!).pathname;
  const mediaId = path.match(/\/(?:ext_tw_video|amplify_video|tweet_video)\/(\d+)\//)?.[1];
  const matching = mediaId ? media.find(item => directPlaybackUrl(item.url) && new URL(item.url).pathname.includes(`/${mediaId}/`)) : undefined;
  const chosen = matching ?? (media.length === 1 ? media[0] : undefined);
  const url = chosen && directPlaybackUrl(chosen.url);
  if (!url) throw new DownloadError(404, "再生する動画を特定できません。（PLAYBACK_NO_MATCH）");
  const hls = chosen?.hlsUrl && directPlaybackUrl(chosen.hlsUrl);
  const hlsUrl = hls && new URL(hls).pathname.endsWith(".m3u8") ? hls : undefined;
  return hlsUrl ? { url, hlsUrl } : { url };
}

export async function refreshPlaybackUrl(id: string, deps: Parameters<typeof refreshPlaybackSources>[1]): Promise<string> {
  return (await refreshPlaybackSources(id, deps)).url;
}
