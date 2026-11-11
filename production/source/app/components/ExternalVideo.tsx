"use client";
import { useEffect, useRef, useState } from "react";
import { safeExternalUrl } from "../../lib/manual-url";

export default function ExternalVideo({ url, poster }: { url: string; poster?: string | null }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const media = safeExternalUrl(url);
  useEffect(() => {
    if (!media || !media.toLowerCase().split("?")[0].endsWith(".m3u8") || !ref.current) return;
    const video = ref.current;
    if (video.canPlayType("application/vnd.apple.mpegurl")) { video.src = media; return; }
    // hls.js is large and rarely needed: load it only when an HLS source actually has to be played,
    // so ranking pages do not download it for every visitor.
    let cancelled = false, engine: { destroy(): void } | null = null;
    void import("../../lib/vendor/hls.mjs").then(({ default: Hls }) => {
      if (cancelled) return;
      if (!Hls.isSupported()) { setFailed(true); return; }
      const hls = new Hls({ enableWorker: false });
      engine = hls;
      hls.loadSource(media); hls.attachMedia(video);
      hls.on(Hls.Events.ERROR, (_event, data) => { if (data.fatal) setFailed(true); });
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; engine?.destroy(); engine = null; };
  }, [media]);
  if (!media) return null;
  return <div>{failed ? <p>埋め込み再生に失敗しました。元URLからご覧ください。</p> :
    <video ref={ref} src={media.toLowerCase().split("?")[0].endsWith(".m3u8") ? undefined : media}
      poster={poster && safeExternalUrl(poster) || undefined} controls playsInline preload="metadata"
      onError={() => setFailed(true)} style={{ width: "100%", maxHeight: "70vh", background: "#000" }} />}</div>;
}
