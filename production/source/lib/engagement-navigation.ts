// Public navigation policy only. No network, storage, server modules or side effects.
const PUBLIC_PAGES = new Set([
  "/", "/rising", "/ranking/daily", "/ranking/weekly", "/reels", "/browse", "/accounts", "/tags",
  "/discover", "/favorites", "/following", "/download", "/download/iphone", "/download/android", "/download-policy", "/privacy", "/terms", "/contact", "/copyright",
  "/advertising-disclosure", "/removal-request",
]);

export function publicEngagementPath(raw: string): string | null {
  const path = raw.length > 1 ? raw.replace(/\/$/, "") : raw;
  if (PUBLIC_PAGES.has(path)) return path;
  if (/^\/p\/[1-9][0-9]{1,24}$/.test(path) || /^\/accounts\/[A-Za-z0-9_-]{1,68}$/.test(path)) return path;
  if (/^\/tags\/[^/]{1,500}$/.test(path)) {
    try {
      const name = decodeURIComponent(path.slice(6));
      if (name && !/[\u0000-\u001f\u007f/\\]/.test(name)) return path;
    } catch { /* Invalid encoded tag paths are not public landing pages. */ }
  }
  return null;
}

export function engagementRange(path: string): string | undefined {
  if (path === "/") return "trending";
  if (path === "/ranking/daily") return "daily";
  if (path === "/ranking/weekly") return "weekly";
  if (path === "/rising") return "rising";
  if (path === "/reels") return "reels";
  if (path === "/discover") return "discover";
  if (path === "/favorites") return "favorites";
  if (path === "/following") return "following";
  if (path === "/browse") return "browse";
  if (path === "/accounts" || path.startsWith("/accounts/")) return "accounts";
  if (path === "/tags" || path.startsWith("/tags/")) return "tags";
  return undefined;
}

export function outboundXEvent(href: string, pathname: string, search = "", sourcePage?: string | null) {
  const path = publicEngagementPath(pathname);
  if (!path) return null;
  try {
    const url = new URL(href, "https://twizou.net");
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password ||
      !["x.com", "www.x.com", "mobile.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com"].includes(url.hostname)) return null;
    const post = url.pathname.match(/^\/(?:[A-Za-z0-9_]{1,15}|i\/web)\/status\/([1-9][0-9]{1,24})(?:\/|$)/);
    const shared = url.pathname === "/intent/tweet" || url.pathname === "/share";
    let xPostId = post?.[1];
    if (!xPostId && shared) {
      const target = new URL(url.searchParams.get("url") ?? "", "https://twizou.net");
      if (target.origin === "https://twizou.net") xPostId = target.pathname.match(/^\/p\/([1-9][0-9]{1,24})$/)?.[1];
    }
    let range = engagementRange(path);
    if (/^\/p\//.test(path)) {
      const from = new URLSearchParams(search).get("from") ?? sourcePage;
      if (from?.startsWith("/") && !from.startsWith("//")) range = engagementRange(from.split("?")[0]);
    }
    return {
      eventType: "outbound_x" as const,
      ...(xPostId ? { xPostId } : {}), ...(range ? { range } : {}),
      source: shared ? "public_x_share" : post ? "public_x_post" : "public_x_link",
      // Do not send destination queries, report fields or full external URLs.
      metadata: { path: path.slice(0, 160), destination: shared ? "share" : post ? "post" : "other" },
    };
  } catch { return null; }
}
