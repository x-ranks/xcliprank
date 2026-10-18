"use client";

import { useCallback, useEffect, useRef, useState, type ComponentPropsWithRef } from "react";
import { fetchDirectVideo } from "../../lib/browser-direct-download";
import { directPlaybackUrl } from "../../lib/browser-direct-playback";
import { attachDirectStream, getStreamingSources } from "../../lib/browser-stream-playback";

type Props = Omit<ComponentPropsWithRef<"video">, "src" | "children"> & {
  src: string | undefined; postId: string; recoverEnabled?: boolean;
};
type Status = { key: string; phase: "recovering" | "stream" | "blob" | "failed"; blob?: string };

export default function DirectPlaybackVideo({ src, postId, recoverEnabled = true, ref: externalRef,
  onError: _onError, onPlay, onLoadedData, ...props }: Props) {
  const node = useRef<HTMLVideoElement | null>(null);
  const identity = `${postId}:${src ?? ""}`;
  const [requested, setRequested] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const current = status?.key === identity ? status : null;
  const wantsPlay = useRef(false);
  const videoRef = useCallback((element: HTMLVideoElement | null) => {
    node.current = element;
    if (typeof externalRef === "function") externalRef(element);
    else if (externalRef) externalRef.current = element;
  }, [externalRef]);

  useEffect(() => {
    if (requested !== identity || !recoverEnabled || !node.current) return;
    const video = node.current, controller = new AbortController();
    let dispose: (() => void) | undefined, blobUrl: string | undefined, blobStarted = false;
    let blobTimer: ReturnType<typeof setTimeout> | undefined;
    const alive = () => !controller.signal.aborted;
    const update = (next: Omit<Status, "key">) => { if (alive()) setStatus({ key: identity, ...next }); };
    const maybePlay = () => {
      if (alive() && (props.autoPlay || wantsPlay.current)) void video.play().catch(() => {});
    };
    update({ phase: "recovering" });
    const blobFallback = async (url: string) => {
      if (!alive() || blobStarted) return;
      blobStarted = true; dispose?.(); dispose = undefined;
      update({ phase: "recovering" });
      blobTimer = setTimeout(() => {
        update({ phase: "failed" });
        controller.abort();
      }, 600000);
      try {
        const blob = await fetchDirectVideo(url, { signal: controller.signal });
        if (!alive()) return;
        blobUrl = URL.createObjectURL(blob);
        update({ phase: "blob", blob: blobUrl });
      } catch {
        if (!alive()) return;
        update({ phase: "failed" });
      } finally { clearTimeout(blobTimer); }
    };
    void getStreamingSources(postId, controller.signal).then(async sources => {
      if (!alive()) return;
      if (!sources.hlsUrl) {
        await blobFallback(sources.url); return;
      }
      try {
        const cleanup = await attachDirectStream(video, sources.hlsUrl, {
          signal: controller.signal,
          onReady: () => { update({ phase: "stream" }); maybePlay(); },
          onError: () => { void blobFallback(sources.url); },
        });
        if (!alive()) cleanup(); else if (!blobStarted) dispose = cleanup; else cleanup();
      } catch {
        if (alive()) await blobFallback(sources.url);
      }
    }).catch(() => {
      if (alive()) update({ phase: "failed" });
    });
    return () => {
      controller.abort(); dispose?.(); clearTimeout(blobTimer);
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [identity, postId, recoverEnabled, requested, props.autoPlay]);

  useEffect(() => {
    if (recoverEnabled && node.current?.error && requested !== identity) setRequested(identity);
  }, [recoverEnabled, requested, identity]);

  const url = directPlaybackUrl(src);
  const message = !url || current?.phase === "failed" ? "動画が再生できません。投稿から動画が再生できるかお試しください。" : undefined;
  return <>
    <video {...props} ref={videoRef} src={current ? current.blob : requested === identity && recoverEnabled ? undefined : url}
      crossOrigin="anonymous" data-xclip-playback={current?.phase ?? "direct"}
      onPlay={event => { wantsPlay.current = true; onPlay?.(event); }}
      onLoadedData={event => {
        if (current?.phase === "blob" && (props.autoPlay || wantsPlay.current)) void event.currentTarget.play().catch(() => {});
        onLoadedData?.(event);
      }}
      onError={event => {
        if (!recoverEnabled) return;
        if (current?.phase === "blob") {
          setStatus({ key: identity, phase: "failed" });
        } else if (requested !== identity) setRequested(identity);
      }} />
    {message && <span role="status" style={{ display: "block", position: "absolute", bottom: 60,
      left: 12, right: 12, zIndex: 5, padding: 10, background: "rgba(0,0,0,.85)", color: "#fff", fontSize: 14 }}>
      {message}
    </span>}
  </>;
}
