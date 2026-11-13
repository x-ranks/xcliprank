/** Browser side of web push: support check, subscribe/unsubscribe and keeping the followed accounts in sync. */
import { isStandaloneDisplay } from "./engagement-surface";

export type PushSupport = "supported" | "unsupported" | "ios-install";
export function pushSupport(win: Window = window): PushSupport {
  const ua = win.navigator.userAgent || "", maxTouch = (win.navigator as { maxTouchPoints?: number }).maxTouchPoints ?? 0;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouch > 1);
  if (ios && !isStandaloneDisplay(win)) return "ios-install";
  return "serviceWorker" in win.navigator && "PushManager" in win && "Notification" in win ? "supported" : "unsupported";
}
const keyBytes = (value: string) => { const bin = atob(value.replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(bin, ch => ch.charCodeAt(0)); };
async function registration() { return navigator.serviceWorker.register("/sw.js", { scope: "/" }).then(() => navigator.serviceWorker.ready); }
const json = { "content-type": "application/json" };
const body = (subscription: PushSubscription, follows: string[]) => JSON.stringify({ ...subscription.toJSON(), follows });

export async function currentPushSubscription(): Promise<PushSubscription | null> {
  try { return await (await registration()).pushManager.getSubscription(); } catch { return null; }
}
export type EnableResult = "ok" | "denied" | "unavailable" | "error";
export async function enablePush(follows: string[]): Promise<EnableResult> {
  try {
    const keyResponse = await fetch("/api/push", { cache: "no-store" });
    const key = keyResponse.ok ? (await keyResponse.json())?.key : null; if (typeof key !== "string") return "unavailable";
    if (await Notification.requestPermission() !== "granted") return "denied";
    const reg = await registration();
    const subscription = await reg.pushManager.getSubscription() ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
    const saved = await fetch("/api/push", { method: "POST", headers: json, body: body(subscription, follows) });
    if (!saved.ok) { await subscription.unsubscribe().catch(() => false); return "error"; }
    return "ok";
  } catch { return "error"; }
}
export async function disablePush(): Promise<boolean> {
  try {
    const subscription = await currentPushSubscription(); if (!subscription) return true;
    await fetch("/api/push", { method: "DELETE", headers: json, body: JSON.stringify({ endpoint: subscription.endpoint }) }).catch(() => undefined);
    return await subscription.unsubscribe();
  } catch { return false; }
}
/** Tells the server which accounts are followed now. Does nothing unless notifications are already on. */
export async function syncPushFollows(follows: string[]): Promise<void> {
  try {
    if (pushSupport() !== "supported" || Notification.permission !== "granted") return;
    const subscription = await currentPushSubscription(); if (!subscription) return;
    await fetch("/api/push", { method: "POST", headers: json, body: body(subscription, follows) });
  } catch { /* Next visit to the follow page syncs again. */ }
}
