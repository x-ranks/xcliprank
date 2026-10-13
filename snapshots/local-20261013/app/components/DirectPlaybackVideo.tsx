"use client";

import { useCallback, useEffect, useRef, useState, type ComponentPropsWithRef } from "react";
import { fetchDirectVideo } from "../../lib/browser-direct-download";
import { directPlaybackUrl } from "../../lib/browser-direct-playback";
import { attachDirectStream, getStreamingSources } from "../../lib/browser-stream-playback";

type Props = Omit<ComponentPropsWithRef<"video">, "src" | "children"> & {
  src: string | undefined; postId: string; recoverEnabled?: boolean;
};
type Status = { key: string; phase: "recovering" | "stream" | "blob" | "failed"; message?: string; blob?: string };

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
    update({ phase: "recovering", message: "動画の分割再生を準備しています…" });
    const blobFallback = async (url: string, reason: string) => {
      if (!alive() || blobStarted) return;
      blobStarted = true; dispose?.(); dispose = undefined;
      update({ phase: "recovering", message: "動画を端末へ直接読み込んでいます…" });
      blobTimer = setTimeout(() => {
        update({ phase: "failed", message: "直接受信が時間切れになりました。（PLAYBACK_TIMEOUT）" });
        controller.abort();
      }, 600000);
      try {
        const blob = await fetchDirectVideo(url, { signal: controller.signal });
        if (!alive()) return;
        blobUrl = URL.createObjectURL(blob);
        update({ phase: "blob", blob: blobUrl });
      } catch (error) {
        if (!alive()) return;
        const detail = error instanceof Error ? error.message : "再生できません。";
        update({ phase: "failed", message: detail.includes("128MB") ?
          `この動画は分割再生を利用できず、全体受信の上限を超えています。${reason}（STREAM_FALLBACK_LIMIT）` : `${detail} ${reason}` });
      } finally { clearTimeout(blobTimer); }
    };
    void getStreamingSources(postId, controller.signal).then(async sources => {
      if (!alive()) return;
      if (!sources.hlsUrl) {
        await blobFallback(sources.url, "（STREAM_NO_PLAYLIST）"); return;
      }
      try {
        const cleanup = await attachDirectStream(video, sources.hlsUrl, {
          signal: controller.signal,
          onReady: () => { update({ phase: "stream" }); maybePlay(); },
          onError: error => { void blobFallback(sources.url, error.message); },
        });
        if (!alive()) cleanup(); else if (!blobStarted) dispose = cleanup; else cleanup();
      } catch (error) {
        if (alive()) await blobFallback(sources.url, error instanceof Error ? error.message : "（STREAM_FAILED）");
      }
    }).catch(error => {
      if (alive()) update({ phase: "failed", message: error instanceof Error ? error.message : "再生情報を取得できません。" });
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
  const message = !url ? "動画URLを確認できません。（PLAYBACK_INVALID_URL）" : current?.message;
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
          setStatus({ key: identity, phase: "failed", message: `端末で動画を再生できません。（PLAYBACK_MEDIA_${event.currentTarget.error?.code ?? 0}）` });
        } else if (requested !== identity) setRequested(identity);
      }} />
    {message && <span role="status" style={{ display: "block", position: "absolute", bottom: 60,
      left: 12, right: 12, zIndex: 5, padding: 10, background: "rgba(0,0,0,.85)", color: "#fff", fontSize: 14 }}>
      {message}
    </span>}
  </>;
}
