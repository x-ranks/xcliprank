"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { fetchDirectVideo } from "../../lib/browser-direct-download";

export default function VideoDownloadButton({ postId, compact = false, token }: { postId: string; compact?: boolean; token?: string | null }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const pendingRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const blobUrlRef = useRef<string | null>(null);
  const savedRef = useRef<File | null>(null);
  const releaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "receiving" | "received" | "error">("loading");
  const [message, setMessage] = useState("");
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [canShare, setCanShare] = useState(false);
  const filename = `xclip-${postId}.mp4`;
  const endpoint = `/api/video-download?postId=${encodeURIComponent(postId)}${token ? `&token=${encodeURIComponent(token)}` : ""}`;

  useEffect(() => {
    if (releaseTimerRef.current) clearTimeout(releaseTimerRef.current);
    pendingRef.current?.abort();
    if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    blobUrlRef.current = null;
    savedRef.current = null;
    setBlobUrl(null); setCanShare(false); setAgreed(false); setStatus("loading"); setMessage("");
    dialogRef.current?.close();
    return () => {
      if (releaseTimerRef.current) clearTimeout(releaseTimerRef.current);
      pendingRef.current?.abort();
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    };
  }, [postId, token]);

  async function check() {
    pendingRef.current?.abort();
    const controller = new AbortController();
    pendingRef.current = controller;
    setStatus("loading"); setMessage("");
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`${endpoint}&check=1`, { signal: controller.signal, cache: "no-store" });
      const result = await response.json();
      if (!response.ok || !result.ready || result.mode !== "browser-direct") throw new Error(result.error ?? "直接保存版の適用を確認してください。");
      if (!controller.signal.aborted) setStatus("ready");
    } catch (error) {
      if (pendingRef.current !== controller) return;
      setStatus("error"); setMessage(controller.signal.aborted ? "確認を中止しました。再試行してください。" : error instanceof Error ? error.message : "通信に失敗しました。");
    } finally { clearTimeout(timer); }
  }

  async function save() {
    if (!agreed || busyRef.current) return;
    busyRef.current = true;
    pendingRef.current?.abort();
    const controller = new AbortController();
    pendingRef.current = controller;
    if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    blobUrlRef.current = null; savedRef.current = null;
    setBlobUrl(null); setCanShare(false); setStatus("receiving"); setMessage("動画を受信しています…");
    const timer = setTimeout(() => controller.abort(), 10 * 60 * 1000);
    let lastProgress = 0;
    try {
      // Xclip returns small JSON only; the next request goes straight to X CDN.
      const response = await fetch(`${endpoint}&consent=1`, { signal: controller.signal, cache: "no-store" });
      const result = await response.json();
      if (!response.ok || !result.ready || result.mode !== "browser-direct" || typeof result.url !== "string") throw new Error(result.error ?? "動画の保存情報を確認できません。");
      const blob = await fetchDirectVideo(result.url, {
        signal: controller.signal,
        onProgress(received, total) {
          if (Date.now() - lastProgress < 200 && received !== total) return;
          lastProgress = Date.now();
          const mb = (received / 1024 / 1024).toFixed(1);
          setMessage(total ? `動画を受信しています… ${Math.min(100, Math.floor(received * 100 / total))}%（${mb}MB）` : `動画を受信しています… ${mb}MB`);
        },
      });
      if (controller.signal.aborted) return;
      const localUrl = URL.createObjectURL(blob);
      blobUrlRef.current = localUrl;
      savedRef.current = new File([blob], filename, { type: "video/mp4" });
      setBlobUrl(localUrl);
      try { setCanShare(!!navigator.canShare?.({ files: [savedRef.current] })); }
      catch { setCanShare(false); }
      const anchor = document.createElement("a");
      anchor.href = localUrl; anchor.download = filename;
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      setStatus("received"); setMessage("受信が完了し、ブラウザへ保存を要求しました。ダウンロード一覧で確認してください。");
    } catch (error) {
      if (pendingRef.current !== controller) return;
      setStatus("error"); setMessage(controller.signal.aborted ? "受信を中止しました。" : error instanceof Error ? error.message : "直接保存に失敗しました。");
    } finally { clearTimeout(timer); busyRef.current = false; }
  }

  async function share() {
    const file = savedRef.current;
    if (!file || !navigator.share) return;
    try { await navigator.share({ files: [file] }); }
    catch (error) { if (!(error instanceof DOMException && error.name === "AbortError")) setMessage("共有できませんでした。「保存し直す」を試してください。"); }
  }

  return (
    <div className={compact ? "video-download compact" : "video-download"} onClick={(event) => event.stopPropagation()}>
      <button type="button" className="video-download-trigger" aria-label="動画を端末に保存" onClick={() => {
        if (busyRef.current) return;
        if (releaseTimerRef.current) clearTimeout(releaseTimerRef.current);
        if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null; savedRef.current = null;
        setBlobUrl(null); setCanShare(false);
        setAgreed(false); dialogRef.current?.showModal(); void check();
      }}>{compact ? <>↓<small>保存</small></> : "↓ 動画を保存"}</button>
      {!compact && <p className="video-download-caption">権利者が保存を許可した動画のみ利用できます。</p>}
      <dialog ref={dialogRef} className="video-download-dialog" aria-labelledby={titleId} onClose={() => {
        pendingRef.current?.abort();
        const finishedUrl = blobUrlRef.current;
        if (releaseTimerRef.current) clearTimeout(releaseTimerRef.current);
        // Give the browser time to consume its download URL, then release memory.
        releaseTimerRef.current = setTimeout(() => {
          if (finishedUrl && blobUrlRef.current === finishedUrl) {
            URL.revokeObjectURL(finishedUrl); blobUrlRef.current = null; savedRef.current = null;
            setBlobUrl(null); setCanShare(false);
          }
        }, 60000);
      }}>
        <h2 id={titleId}>動画を端末に保存</h2>
        <p>権利者が保存を許可した動画のみ利用してください。Xで公開されていることは、保存・転載の許可を意味しません。</p>
        <p><strong>違法な動画、権利侵害・非同意の動画、未成年者の性的な動画の保存は禁止します。</strong>許可のない転載・再配布も禁止します。</p>
        <p>保存する動画はXからお使いの端末へ直接受信します。</p>
        <p><Link href="/download-policy" target="_blank" rel="noopener noreferrer">保存ポリシー</Link> ／ <Link href="/download-policy#report" target="_blank" rel="noopener noreferrer">問題のある動画への対応</Link></p>
        <label className="video-download-consent"><input type="checkbox" checked={agreed} disabled={status === "receiving"}
          onChange={(event) => setAgreed(event.target.checked)} />保存の許可を確認し、注意事項に同意します。</label>
        <p role="status" aria-live="polite">{message || (status === "loading" ? "保存情報を確認しています…" : "保存ボタンから受信・保存してください。")}</p>
        <div className="video-download-actions">
          {blobUrl && agreed ? <a className="video-download-confirm" href={blobUrl} download={filename}>保存し直す</a> :
            <button type="button" className="video-download-confirm" disabled={!agreed || status !== "ready"} onClick={() => void save()}>動画を保存する</button>}
          {blobUrl && agreed && canShare && <button type="button" onClick={() => void share()}>共有・保存先を選ぶ</button>}
          {status === "receiving" && <button type="button" onClick={() => pendingRef.current?.abort()}>受信を中止</button>}
          {status === "error" && <button type="button" onClick={() => void check()}>再試行</button>}
          <button type="button" onClick={() => dialogRef.current?.close()}>閉じる</button>
        </div>
        <p className="video-download-help">この直接保存版は128MBまで対応します。端末・ブラウザによっては「保存し直す」や共有メニューから保存先を選んでください。</p>
      </dialog>
    </div>
  );
}
