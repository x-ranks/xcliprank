import { directPlaybackUrl } from "./browser-direct-playback";
import type Hls from "./vendor/hls.mjs";

export function streamingPlaylistUrl(raw: unknown): string | undefined {
  const url = typeof raw === "string" && directPlaybackUrl(raw);
  return url && new URL(url).pathname.toLowerCase().endsWith(".m3u8") ? url : undefined;
}

export function directStreamRequest(url: string, init: RequestInit): Request {
  const allowed = directPlaybackUrl(url);
  if (!allowed) throw new Error("分割再生の接続先を確認できません。（STREAM_INVALID_URL）");
  return new Request(allowed, { ...init, mode: "cors", credentials: "omit", redirect: "error",
    referrerPolicy: "no-referrer" });
}

export async function getStreamingSources(postId: string, signal: AbortSignal,
  fetcher: typeof fetch = fetch): Promise<{ url: string; hlsUrl?: string }> {
  if (!/^\d{2,20}$/.test(postId)) throw new Error("投稿IDを確認してください。（STREAM_INVALID_ID）");
  const response = await fetcher(`/api/video-playback-url?postId=${encodeURIComponent(postId)}`, {
    cache: "no-store", credentials: "same-origin", signal,
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`${body.error ?? "無料の再生情報を取得できません。"} [HTTP ${response.status}]`);
  const url = directPlaybackUrl(body.url);
  if (!url) throw new Error("再生URLを確認できません。（STREAM_INVALID_MP4）");
  return { url, hlsUrl: streamingPlaylistUrl(body.hlsUrl) };
}

type Options = { signal: AbortSignal; onReady: () => void; onError: (error: Error) => void };
// Only the user's browser invokes this. All manifests, segments and keys use a guarded CDN fetch.
export async function attachDirectStream(video: HTMLVideoElement, raw: string, options: Options,
  loadLibrary: () => Promise<typeof import("./vendor/hls.mjs")> = () => import("./vendor/hls.mjs")):
  Promise<() => void> {
  const url = streamingPlaylistUrl(raw);
  if (!url) throw new Error("分割再生URLを確認できません。（STREAM_NO_PLAYLIST）");
  if (options.signal.aborted) throw new DOMException("Aborted", "AbortError");
  const { default: Engine, FetchLoader } = await loadLibrary();
  if (options.signal.aborted) throw new DOMException("Aborted", "AbortError");
  let engine: Hls | null = null, closed = false, ready = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cleanup = () => {
    if (closed) return;
    closed = true; clearTimeout(timer);
    options.signal.removeEventListener("abort", cleanup);
    video.removeEventListener("loadeddata", markReady);
    video.removeEventListener("error", nativeError);
    engine?.destroy(); engine = null;
    video.pause(); video.removeAttribute("src"); video.load();
  };
  const markReady = () => {
    if (closed || ready) return;
    ready = true; clearTimeout(timer); options.onReady();
  };
  const fail = (error: Error) => {
    if (closed) return;
    cleanup(); options.onError(error);
  };
  const nativeError = () => fail(new Error(`分割再生に失敗しました。（STREAM_NATIVE_${video.error?.code ?? 0}）`));
  options.signal.addEventListener("abort", cleanup, { once: true });
  video.addEventListener("loadeddata", markReady);
  timer = setTimeout(() => fail(new Error("分割再生の読み込みが時間切れになりました。（STREAM_TIMEOUT）")), 45000);
  try {
    if (Engine.isSupported()) {
      engine = new Engine({ loader: FetchLoader, enableWorker: false, autoStartLoad: true,
        maxBufferLength: 30, maxMaxBufferLength: 30, maxBufferSize: 32 * 1024 * 1024,
        backBufferLength: 10, capLevelToPlayerSize: true, startLevel: -1,
        fetchSetup: async (context, init) => directStreamRequest(context.url, init) });
      engine.on(Engine.Events.ERROR, (_event, data) => {
        if (data.fatal) fail(new Error(`分割再生に失敗しました。（STREAM_${data.details}）`));
      });
      engine.on(Engine.Events.MEDIA_ATTACHED, () => { if (!closed) engine?.loadSource(url); });
      engine.attachMedia(video);
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      // Safari's native HLS loader uses the browser's own HTTP/referrer behavior.
      video.addEventListener("error", nativeError);
      video.src = url; video.load();
    } else throw new Error("このブラウザは分割再生に対応していません。（STREAM_UNSUPPORTED）");
    return cleanup;
  } catch (error) { cleanup(); throw error; }
}
