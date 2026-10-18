export function directPlaybackUrl(raw: string | null | undefined): string | undefined {
  if (typeof raw !== "string" || raw.length > 4096) return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") ||
        !(url.hostname === "video.twimg.com" || url.hostname.endsWith(".video.twimg.com"))) return undefined;
    return url.href;
  } catch { return undefined; }
}

// Runs on the user's browser only; no fetch or Xclip metadata endpoint.
export function readDirectVideoDuration(raw: string, timeoutMs = 12000): Promise<number | null> {
  const url = directPlaybackUrl(raw);
  if (!url || typeof document === "undefined") return Promise.resolve(null);
  return new Promise(resolve => {
    const video = document.createElement("video");
    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (seconds: number | null) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      video.onloadedmetadata = null;
      video.onerror = null;
      try { video.pause(); video.removeAttribute("src"); video.load(); } catch { /* Release best effort. */ }
      resolve(seconds);
    };
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.onloadedmetadata = () => finish(Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null);
    video.onerror = () => finish(null);
    timer = setTimeout(() => finish(null), timeoutMs);
    try { video.src = url; video.load(); } catch { finish(null); }
  });
}

// Duration is small JSON from free post metadata, never a video-data request.
export async function readPostVideoDuration(postId: string, signal: AbortSignal,
  fetcher: typeof fetch = fetch): Promise<number | null> {
  if (!/^\d{2,20}$/.test(postId) || signal.aborted) return null;
  try {
    const response = await fetcher(`/api/video-playback-url?postId=${encodeURIComponent(postId)}`, {
      signal, cache: "no-store", credentials: "same-origin",
    });
    if (!response.ok) { await response.body?.cancel(); return null; }
    const body = await response.json();
    if (signal.aborted || body.mode !== "browser-direct" || !directPlaybackUrl(body.url)) return null;
    const value = body.durationSeconds;
    return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 86400 ? value : null;
  } catch { return null; }
}
