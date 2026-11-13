"use client";
import { useEffect, useState } from "react";
import { FOLLOW_EVENT, FOLLOW_LIMIT, readFollows, setFollow, validAccountKey } from "../../lib/follows";
import { syncPushFollows } from "../../lib/push-client";

/** Follows an account in this browser only. The key is the public account key (lower-case). */
export default function FollowButton({ accountKey, compact = false }: { accountKey: string; compact?: boolean }) {
  const key = accountKey.toLowerCase();
  const [active, setActive] = useState(false), [error, setError] = useState(false);
  useEffect(() => {
    const refresh = () => { try { setActive(readFollows(window.localStorage).includes(key)); } catch { setError(true); } };
    refresh(); window.addEventListener("storage", refresh); window.addEventListener(FOLLOW_EVENT, refresh);
    return () => { window.removeEventListener("storage", refresh); window.removeEventListener(FOLLOW_EVENT, refresh); };
  }, [key]);
  if (!validAccountKey(key)) return null;
  return <span className="follow-control"><button type="button" className="follow-button" aria-pressed={active} aria-label={active ? "この投稿者のフォローを解除" : "この投稿者をフォロー"} onClick={() => {
    try { if (!setFollow(window.localStorage, key, !active)) throw Error(); setError(false); window.dispatchEvent(new Event(FOLLOW_EVENT)); void syncPushFollows(readFollows(window.localStorage)); }
    catch { setError(true); }
  }}>{active ? "✓ フォロー中" : "＋ フォロー"}</button>
    {error && <span role="status">フォローできませんでした。上限{FOLLOW_LIMIT}人またはブラウザの保存設定をご確認ください。</span>}
    {compact ? null : <a className="follow-feed-link" href="/following">フォロー中の新着を見る</a>}</span>;
}
