"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import VideoDownloadButton from "../components/VideoDownloadButton";

type Result = { id: string; videos: { token: string | null }[] };
export default function DownloadForm() {
  const [url, setUrl] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!agreed || loading) return;
    pending.current?.abort(); const controller = new AbortController(); pending.current = controller;
    setLoading(true); setResult(null); setMessage("");
    const timer = setTimeout(() => controller.abort(), 60000);
    try {
      const response = await fetch("/api/video-resolve", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, consent: agreed }), signal: controller.signal });
      if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
        await response.body?.cancel();
        throw new Error(`保存APIの応答を確認できません。（RESOLVE_NOT_JSON / HTTP ${response.status}）`);
      }
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(`${body.error ?? "投稿を取得できません。"} [HTTP ${response.status}]`);
      if (!controller.signal.aborted) { setResult(body); setMessage(`${body.videos.length}件の動画が見つかりました。保存ボタンを押してください。`); }
    } catch (error) {
      if (pending.current === controller) setMessage(controller.signal.aborted ? "投稿の確認が時間切れになりました。（RESOLVE_TIMEOUT）" : error instanceof Error ? error.message : "通信に失敗しました。（RESOLVE_NETWORK）");
    } finally { clearTimeout(timer); if (pending.current === controller) setLoading(false); }
  }
  return (
    <main className="download-page">
      <nav className="ranking-page-nav download-site-nav" aria-label="サイトメニュー">
        <Link href="/">新着</Link>
        <Link href="/ranking/daily">24時間</Link>
        <Link href="/ranking/weekly">週間</Link>
        <Link href="/reels">リール</Link>
        <Link href="/download" className="active" aria-current="page">動画保存</Link>
      </nav>
      <Link href="/">← ランキングへ戻る</Link>
      <h1>投稿URLから動画を保存</h1>
      <p>X・Twitterの公開投稿URLを貼り付けてください。</p>
      <p>サイト内にない投稿は、外部サービスFxTwitterで取得を試みます。投稿IDが外部サービスへ送信されます。取得できない場合は保存できません。</p>
      <div className="download-notice">
        <strong>権利者が保存を許可した動画のみ利用できます。</strong>
        <p>違法・権利侵害・非同意の動画、未成年者の性的な動画の保存は禁止します。許可のない転載・再配布も禁止します。</p>
        <p>保存する動画はXからお使いの端末へ直接受信します。無料取得に失敗した場合は保存できません。有料取得への切り替えは行いません。</p>
        <Link href="/download-policy">保存ポリシーを確認する</Link>
      </div>
      <form onSubmit={submit}>
        <label htmlFor="download-post-url">投稿URL</label>
        <input id="download-post-url" type="url" required maxLength={2048} value={url}
          placeholder="https://x.com/username/status/1234567890" disabled={loading}
          onChange={(event) => { setUrl(event.target.value); setResult(null); setMessage(""); }} />
        <label className="video-download-consent"><input type="checkbox" checked={agreed} disabled={loading}
          onChange={(event) => { setAgreed(event.target.checked); if (!event.target.checked) setResult(null); }} />保存の許可を確認し、注意事項に同意します。</label>
        <button type="submit" className="video-download-trigger" disabled={!agreed || loading}>{loading ? "動画を確認しています…" : "動画を確認する"}</button>
      </form>
      <p role="status" aria-live="polite">{message}</p>
      {result && agreed && <section aria-label="見つかった動画">
        <a href={`https://x.com/i/web/status/${result.id}`} target="_blank" rel="noopener noreferrer">Xで元投稿を確認する ↗</a>
        {result.videos.map((video, index) => <div className="download-result" key={`${result.id}-${index}`}>
          <h2>動画 {index + 1}</h2><VideoDownloadButton postId={result.id} token={video.token} />
        </div>)}
        {result.videos.some(video => video.token) && <p>保存用の情報は約10分で失効します。保存できない場合は投稿URLから確認し直してください。</p>}
      </section>}
      <p className="video-download-help">非公開・削除・除外対象の投稿は利用できません。無料の新規取得には1日の利用上限があります。完了はブラウザのダウンロード一覧で確認してください。</p>
      <Link href="/reels">Reelsから動画を探す</Link>
    </main>
  );
}
