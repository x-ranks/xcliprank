"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import PublicPostLink from "./PublicPostLink";
import PublicThumbnail from "./PublicThumbnail";
import FavoriteButton from "./FavoriteButton";
import { FOLLOW_EVENT, isNewForFollower, readFollowSeen, readFollows, setFollow, writeFollowSeen } from "../../lib/follows";

type Card = { id: string; handle: string | null; authorName: string | null; text: string | null; posterUrl: string | null; createdAt: string | null };

export default function FollowFeed() {
  const [keys, setKeys] = useState<string[] | null>(null), [cards, setCards] = useState<Card[]>([]);
  const [busy, setBusy] = useState(true), [error, setError] = useState(""), [retry, setRetry] = useState(0), [seen, setSeen] = useState(0);
  useEffect(() => {
    try { setSeen(readFollowSeen(window.localStorage)); } catch { /* No saved look: nothing is marked new. */ }
    const refresh = () => { try { setKeys(readFollows(window.localStorage)); } catch { setKeys([]); setError("この端末の保存領域を読めませんでした。"); } };
    refresh(); window.addEventListener("storage", refresh); window.addEventListener(FOLLOW_EVENT, refresh);
    return () => { window.removeEventListener("storage", refresh); window.removeEventListener(FOLLOW_EVENT, refresh); };
  }, []);
  const keyList = keys?.join(",") ?? null;
  useEffect(() => {
    if (keyList === null) return;
    if (!keyList) { setCards([]); setBusy(false); return; }
    const controller = new AbortController(); setBusy(true); setError("");
    (async () => {
      try {
        const response = await fetch("/api/follow-feed", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ keys: keyList.split(",") }), signal: controller.signal });
        const data = await response.json(); if (!response.ok || !data.ok || !Array.isArray(data.videos)) throw Error();
        if (controller.signal.aborted) return;
        // The NEW marks use the look recorded when this page opened; record this look for the next visit.
        setCards(data.videos); writeFollowSeen(window.localStorage, Date.now());
      } catch { if (!controller.signal.aborted) setError("読み込めませんでした。"); }
      finally { if (!controller.signal.aborted) setBusy(false); }
    })();
    return () => controller.abort();
  }, [keyList, retry]);
  const unfollow = (key: string) => { try { if (setFollow(window.localStorage, key, false)) window.dispatchEvent(new Event(FOLLOW_EVENT)); } catch { setError("解除できませんでした。"); } };
  const fresh = cards.filter(card => isNewForFollower(card.createdAt, seen)).length;
  return <div className="follow-feed">
    <p>フォローは、この端末のブラウザに保存されます（最大30人）。ブラウザのデータを消去すると、フォローも消えます。</p>
    {keys && keys.length > 0 && <ul className="follow-list" aria-label="フォロー中の投稿者">{keys.map(key => <li key={key}>
      <Link href={`/accounts/${encodeURIComponent(key)}`}>@{key.replace(/^id-/, "")}</Link> <button type="button" onClick={() => unfollow(key)} aria-label={`@${key}のフォローを解除`}>解除</button></li>)}</ul>}
    {keys && keys.length === 0 && !busy && <p>まだ誰もフォローしていません。気になる投稿者のページで「＋ フォロー」を押すと、新しい動画がここにまとまります。<Link href="/accounts">投稿者一覧を見る</Link></p>}
    {fresh > 0 && <p className="follow-new-note" role="status">前回から新着が{fresh}件あります。</p>}
    {error && <p role="alert">{error} <button type="button" onClick={() => setRetry(n => n + 1)}>再試行</button></p>}{busy && keys && keys.length > 0 && <p role="status">読み込み中…</p>}
    {!busy && !error && keys && keys.length > 0 && cards.length === 0 && <p>表示できる動画はありません。</p>}
    <div className="video-grid">{cards.map(card => <article className={isNewForFollower(card.createdAt, seen) ? "video-card follow-new" : "video-card"} key={card.id}>
      <PublicPostLink id={card.id} returnTo="/following" style={{ display: "block", color: "inherit", textDecoration: "none" }}>
        {card.posterUrl ? <PublicThumbnail src={card.posterUrl} alt="動画のサムネイル" width={392} height={220} loading="lazy" decoding="async" style={{ display: "block", width: "100%", height: 220, objectFit: "contain", background: "#08111e" }} /> : <div style={{ height: 120 }}>動画を開く</div>}
        {isNewForFollower(card.createdAt, seen) && <span className="follow-new-badge">NEW</span>}
        <p>{card.authorName || card.handle || "投稿者"}</p><p>{Array.from(card.text ?? "").slice(0, 100).join("")}</p>
      </PublicPostLink><FavoriteButton id={card.id} />
    </article>)}</div>
    <p><Link href="/accounts">投稿者一覧</Link> ／ <Link href="/favorites">お気に入り・履歴</Link></p>
  </div>;
}
