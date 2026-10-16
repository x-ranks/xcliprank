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
