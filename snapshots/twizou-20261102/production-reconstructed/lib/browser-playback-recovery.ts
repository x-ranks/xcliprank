import { fetchDirectVideo } from "./browser-direct-download";
import { directPlaybackUrl } from "./browser-direct-playback";

export async function recoverDirectPlayback(raw: string, postId: string, signal: AbortSignal,
  fetcher: typeof fetch = fetch): Promise<Blob> {
  const url = directPlaybackUrl(raw);
  if (!url) throw new Error("動画URLを確認できません。（PLAYBACK_INVALID_URL）");
  try {
    return await fetchDirectVideo(url, { signal, fetcher });
  } catch (error) {
    if (signal.aborted) throw error;
    // A large video cannot use this device-memory fallback. Do not download it again.
    if (error instanceof Error && error.message.includes("128MB")) throw error;
  }
  const response = await fetcher(`/api/video-playback-url?postId=${encodeURIComponent(postId)}`, {
    cache: "no-store", credentials: "same-origin", signal,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`${data.error ?? "再生URLを更新できません。"} [HTTP ${response.status}]`);
  const refreshed = directPlaybackUrl(data.url);
  if (!refreshed) throw new Error("更新した動画URLを確認できません。（PLAYBACK_INVALID_REFRESH）");
  try { return await fetchDirectVideo(refreshed, { signal, fetcher }); }
  catch (error) {
    if (signal.aborted) throw error;
    throw new Error(`${error instanceof Error ? error.message : "直接通信に失敗しました。"}（PLAYBACK_DIRECT_FAILED）`);
  }
}
