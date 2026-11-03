"use client";
import { useEffect, useRef, useState } from "react";
import Hls from "../../lib/vendor/hls.mjs";
import { safeExternalUrl } from "../../lib/manual-url";

export default function ExternalVideo({ url, poster }: { url: string; poster?: string | null }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const media = safeExternalUrl(url);
  useEffect(() => {
    if (!media || !media.toLowerCase().split("?")[0].endsWith(".m3u8") || !ref.current) return;
    const video = ref.current;
    if (video.canPlayType("application/vnd.apple.mpegurl")) { video.src = media; return; }
    if (!Hls.isSupported()) { setFailed(true); return; }
    const hls = new Hls({ enableWorker: false });
    hls.loadSource(media); hls.attachMedia(video);
    hls.on(Hls.Events.ERROR, (_event, data) => { if (data.fatal) setFailed(true); });
    return () => hls.destroy();
  }, [media]);
  if (!media) return null;
  return <div>{failed ? <p>埋め込み再生に失敗しました。元URLからご覧ください。</p> :
    <video ref={ref} src={media.toLowerCase().split("?")[0].endsWith(".m3u8") ? undefined : media}
      poster={poster && safeExternalUrl(poster) || undefined} controls playsInline preload="metadata"
      onError={() => setFailed(true)} style={{ width: "100%", maxHeight: "70vh", background: "#000" }} />}</div>;
}
