"use client";

import { useCallback, useEffect, useRef, useState, type ComponentPropsWithRef } from "react";
import { trackEngagement } from "../../lib/engagement-client";
import { engagementRange } from "../../lib/engagement-navigation";
import { publicReturnForPost, RETURN_STORAGE_KEY } from "../../lib/public-return-navigation";
import { createPlaybackCounter } from "../../lib/engagement-playback";
import { directPlaybackUrl } from "../../lib/browser-direct-playback";
import { attachDirectStream, getStreamingSources } from "../../lib/browser-stream-playback";

type Props = Omit<ComponentPropsWithRef<"video">, "src" | "children"> & {
  src: string | undefined; postId: string; recoverEnabled?: boolean; trackQualifiedView?: boolean; trackReelOpen?: boolean; engagementSourcePage?: string | null;
};
type Status = { key: string; phase: "recovering" | "refreshed" | "stream" | "blob" | "failed"; blocked?: boolean; blob?: string; native?: string };

export default function DirectPlaybackVideo({ src, postId, recoverEnabled = true, trackQualifiedView = false, trackReelOpen = false, engagementSourcePage, ref: externalRef,
  onError: _onError, onPlay, onLoadedData, ...props }: Props) {
  const node = useRef<HTMLVideoElement | null>(null);
  const identity = `${postId}:${src ?? ""}`;
  const [requested, setRequested] = useState<string | null>(null);
  const [streamRequested, setStreamRequested] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [dismissedNoticeFor, setDismissedNoticeFor] = useState<string | null>(null);
  const current = status?.key === identity ? status : null;
  const wantsPlay = useRef(false);
  const continueRecovery = useRef<(() => void) | null>(null);
  const videoRef = useCallback((element: HTMLVideoElement | null) => {
    node.current = element;
    if (typeof externalRef === "function") externalRef(element);
    else if (externalRef) externalRef.current = element;
  }, [externalRef]);

  useEffect(() => {
    const video = node.current; if (!video || (!trackQualifiedView && !trackReelOpen)) return;
    const counter = createPlaybackCounter(); let opened = false;
    const range = () => { let stored: string | null = null; try { stored = sessionStorage.getItem(RETURN_STORAGE_KEY); } catch {}
      const from = engagementSourcePage || publicReturnForPost(postId, null, stored) || window.location.pathname;
      const base = from.split("?")[0]; return engagementRange(base) ?? (/^\/p\//.test(base) ? "landing" : undefined); };
    const reset = () => counter.reset();
    const playing = () => { reset(); if (trackReelOpen && !opened) { opened = true; trackEngagement({ eventType: "video_open", xPostId: postId, range: "reels", source: "reel_play" }); } tick(); };
    const tick = () => { if (trackQualifiedView && counter.tick(video.currentTime, performance.now(), video.playbackRate, !video.paused && !video.seeking && document.visibilityState === "visible")) trackEngagement({ eventType: "qualified_view", xPostId: postId, range: range(), source: trackReelOpen ? "reel_play" : "post_player", metadata: { seconds: 5 } }); };
    video.addEventListener("playing", playing); video.addEventListener("timeupdate", tick); video.addEventListener("pause", reset); video.addEventListener("waiting", reset); video.addEventListener("seeking", reset); document.addEventListener("visibilitychange", reset);
    return () => { video.removeEventListener("playing", playing); video.removeEventListener("timeupdate", tick); video.removeEventListener("pause", reset); video.removeEventListener("waiting", reset); video.removeEventListener("seeking", reset); document.removeEventListener("visibilitychange", reset); };
  }, [postId, trackQualifiedView, trackReelOpen, engagementSourcePage]);

  useEffect(() => {
    const video = node.current;
    return () => {
      // Ref detachment happens before passive cleanup. The microtask also lets
      // Strict Mode reattach its same node without clearing the current source.
      queueMicrotask(() => {
        if (!video || node.current === video) return;
        video.pause(); video.removeAttribute("src"); video.load();
      });
    };
  }, []);

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
    continueRecovery.current = null;
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
        const { fetchDirectVideo } = await import("../../lib/browser-direct-download");
        if (!alive()) return;
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
      const recoverStream = async () => {
      if (!alive()) return;
      update({ phase: "recovering" });
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
      };
      // A refreshed MP4 may play natively without CORS/HLS or whole-file Blob reception.
      if (sources.url !== directPlaybackUrl(src)) {
        continueRecovery.current = () => { continueRecovery.current = null; void recoverStream(); };
        update({ phase: "refreshed", native: sources.url });
      } else await recoverStream();
    }).catch(error => {
      if (alive()) update({ phase: "failed", blocked: /\[HTTP (?:400|401|403|404|410)\]/.test(error instanceof Error ? error.message : "") });
    });
    return () => {
      continueRecovery.current = null;
      controller.abort(); dispose?.(); clearTimeout(blobTimer);
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [identity, postId, recoverEnabled, requested, props.autoPlay]);

  useEffect(() => {
    if (recoverEnabled && node.current?.error && requested !== identity) setRequested(identity);
  }, [recoverEnabled, requested, identity]);

  // The refreshed native src must be removed by React before HLS attaches its
  // own src/MediaSource. Otherwise the following commit can erase that source.
  useEffect(() => {
    if (streamRequested !== identity || current?.phase !== "recovering") return;
    const resume = continueRecovery.current;
    continueRecovery.current = null;
    resume?.();
  }, [streamRequested, identity, current?.phase]);

  const url = directPlaybackUrl(src);
  const message = !url || current?.phase === "failed" ? "動画が再生できません。投稿から動画が再生できるかお試しください。" : undefined;
  return <>
    <video {...props} ref={videoRef} src={current?.phase === "failed" && !current.blocked ? url : current ? current.native ?? current.blob : requested === identity && recoverEnabled ? undefined : url}
      data-xclip-playback={current?.phase ?? "direct"}
      onPlay={event => { wantsPlay.current = true; onPlay?.(event); }}
      onLoadedData={event => {
        if (current?.phase === "failed" && !current.blocked) {
          setStatus(null); setRequested(null);
          if (props.autoPlay || wantsPlay.current) void event.currentTarget.play().catch(() => {});
        }
        if ((current?.phase === "blob" || current?.phase === "refreshed") && (props.autoPlay || wantsPlay.current)) void event.currentTarget.play().catch(() => {});
        onLoadedData?.(event);
      }}
      onError={event => {
        if (!recoverEnabled) return;
        if (current?.phase === "refreshed") {
          setStatus({ key: identity, phase: "recovering" });
          setStreamRequested(identity);
        } else if (current?.phase === "blob") {
          setStatus({ key: identity, phase: "failed" });
        } else if (requested !== identity) setRequested(identity);
      }} />
    {message && dismissedNoticeFor !== identity && <div role="status" className="direct-playback-notice">
      <span>{message}</span>
      <button type="button" className="direct-playback-notice-close" aria-label="再生エラーの案内を閉じる"
        onClick={() => setDismissedNoticeFor(identity)}>×</button>
    </div>}
  </>;
}
