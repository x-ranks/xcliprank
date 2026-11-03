import { PUBLIC_SITE, publicPostId } from "./public-video-core";
type ShareContext = { author?: string | null; section?: "trending" | "daily" | "weekly" | "rising"; rank?: number; updatedAt?: string };
export function shareVideoHref(postId: string, fallback?: string | null, context: ShareContext = {}) {
  let url = publicPostId(postId) ? PUBLIC_SITE + "/p/" + postId : "";
  if (!url && fallback) {
    try { const candidate = new URL(fallback); if (candidate.protocol === "https:" && !candidate.username && !candidate.password && ["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(candidate.hostname)) url = candidate.href; } catch { /* Invalid links are not shared. */ }
  }
  if (!url) return null;
  const author = Array.from((context.author ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/https?:\/\/\S+/gi, "").replace(/\s+/g, " ").trim()).slice(0, 36).join("");
  let text = (author ? author + "の動画" : "この動画") + "をtwizouでチェック";
  const section = context.section === "trending" ? "新着" : context.section === "daily" ? "24時間ランキング" : context.section === "weekly" ? "週間ランキング" : context.section === "rising" ? "急上昇ランキング" : null;
  if (section) text = (author ? author + "の動画" : "この動画") + "｜twizou " + section + "に掲載中";
  if (context.section === "rising" && Number.isSafeInteger(context.rank) && context.rank! >= 1 && context.rank! <= 50 && context.updatedAt && Number.isFinite(Date.parse(context.updatedAt))) {
    const at = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(context.updatedAt));
    text = (author ? author + "の動画" : "この動画") + "｜twizou 急上昇ランキング" + context.rank + "位（" + at + "集計・日本時間）";
  }
  return "https://twitter.com/intent/tweet?" + new URLSearchParams({ text, url });
}
