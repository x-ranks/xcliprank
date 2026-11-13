"use client";
import { useEffect, useState } from "react";
import { FOLLOW_EVENT, readFollows } from "../../lib/follows";
import { currentPushSubscription, disablePush, enablePush, pushSupport, syncPushFollows, type PushSupport } from "../../lib/push-client";

/** Opt-in switch for one plain notification per day when a followed author posts. Off until the person turns it on. */
export default function PushToggle() {
  const [support, setSupport] = useState<PushSupport | null>(null), [on, setOn] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  useEffect(() => {
    const kind = pushSupport(); setSupport(kind);
    if (kind !== "supported") return;
    (async () => {
      const subscription = Notification.permission === "granted" ? await currentPushSubscription() : null;
      setOn(Boolean(subscription));
      if (subscription) { try { await syncPushFollows(readFollows(window.localStorage)); } catch { /* sync is best effort */ } }
    })();
    const sync = () => { try { void syncPushFollows(readFollows(window.localStorage)); } catch { /* best effort */ } };
    window.addEventListener(FOLLOW_EVENT, sync); return () => window.removeEventListener(FOLLOW_EVENT, sync);
  }, []);
  if (support === null) return null;
  if (support === "unsupported") return <p className="push-note">この端末のブラウザでは、新着の通知を使えません。</p>;
  if (support === "ios-install") return <p className="push-note">iPhoneで通知を使うには、先に「ホーム画面に追加」して、そのアイコンから開いてください。</p>;
  const turnOn = async () => {
    setBusy(true); setMessage("");
    let follows: string[] = []; try { follows = readFollows(window.localStorage); } catch { /* treated as none */ }
    if (!follows.length) { setMessage("先に、通知してほしい投稿者をフォローしてください。"); setBusy(false); return; }
    const result = await enablePush(follows);
    setOn(result === "ok");
    setMessage(result === "ok" ? "通知をオンにしました。新着があった日の夜に、1日1回まで通知します。" : result === "denied" ? "通知が許可されませんでした。ブラウザの設定で、このサイトの通知を許可してください。" : result === "unavailable" ? "通知は、まだ準備中です。" : "通知をオンにできませんでした。時間をおいてお試しください。");
    setBusy(false);
  };
  const turnOff = async () => { setBusy(true); const ok = await disablePush(); if (ok) setOn(false); setMessage(ok ? "通知をオフにしました。" : "オフにできませんでした。"); setBusy(false); };
  return <section className="push-toggle" aria-label="新着の通知">
    <p>フォロー中の投稿者に新着があったとき、1日1回まで通知します。通知には動画の内容は表示されません。</p>
    <button type="button" className="follow-button" aria-pressed={on} disabled={busy} onClick={on ? turnOff : turnOn}>{on ? "通知をオフにする" : "新着を通知する"}</button>
    <p role="status">{message}</p>
  </section>;
}
