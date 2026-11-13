const origin = "https://twizou.net";
export const RETURN_STORAGE_KEY = "xclip-public-return-v1";
export function safePublicReturn(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 1600 || !raw.startsWith("/") || raw.startsWith("//") || /[\\\u0000-\u0020\u007f]/.test(raw)) return null;
  try {
    const u = new URL(raw, origin); if (u.origin !== origin || u.hash) return null;
    if (!(["/", "/ranking/daily", "/ranking/weekly", "/rising", "/reels", "/browse", "/discover", "/favorites", "/following"].includes(u.pathname) || /^\/accounts\/[A-Za-z0-9_-]{1,68}$/.test(u.pathname) || /^\/tags\/[^/]{1,500}$/.test(u.pathname))) return null;
    if (u.pathname === "/discover" || u.pathname === "/favorites") {
      for (const key of u.searchParams.keys()) if (!["mode", "q", "month", "tier", "seed"].includes(key) || u.searchParams.getAll(key).length !== 1) return null;
      const mode = u.searchParams.get("mode"), q = u.searchParams.get("q"), month = u.searchParams.get("month"), tier = u.searchParams.get("tier"), seed = u.searchParams.get("seed");
      if (mode && !(u.pathname === "/favorites" ? ["favorites", "saveHistory"] : ["random", "search", "month", "tier"]).includes(mode)) return null;
      if (q !== null && (q.length > 80 || /[\u0000-\u001f\u007f]/.test(q))) return null;
      if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null;
      if (tier && !["S", "A+", "A", "B+", "B", "C"].includes(tier)) return null;
      if (seed && (!/^\d{1,10}$/.test(seed) || Number(seed) > 0xffffffff)) return null;
      return u.pathname + (u.searchParams.size ? "?" + u.searchParams.toString() : "");
    }
    const query = new URLSearchParams();
    for (const key of u.searchParams.keys()) if (!["page", "edition"].includes(key) || u.searchParams.getAll(key).length !== 1) return null;
    const page = u.searchParams.get("page"), edition = u.searchParams.get("edition");
    if (page !== null) {
      const pagedHub = u.pathname === "/browse" || /^\/tags\/[^/]{1,500}$/.test(u.pathname) || /^\/accounts\/[A-Za-z0-9_-]{1,68}$/.test(u.pathname);
      if (pagedHub ? !/^[1-9]\d{0,3}$/.test(page) : u.pathname !== "/" || !/^(?:[1-9]|10)$/.test(page)) return null;
      if (page !== "1") query.set("page", page);
    }
    if (edition !== null) { if (!/^[A-Za-z0-9_-]{1,160}$/.test(edition)) return null; query.set("edition", edition); }
    return u.pathname + (query.size ? "?" + query.toString() : "");
  } catch { return null; }
}
export function publicDetailHref(id: string, _from?: string) {
  if (!/^[1-9][0-9]{1,24}$/.test(id)) throw Error("PUBLIC_INVALID_ID");
  // Return context is kept in sessionStorage, not in crawlable URL variants.
  return "/p/" + id;
}
export type ReturnPosition = { version: 1; from: string; postId: string; y: number; at: number; restore: boolean; historyLength?: number; navigation?: "client" | "native" };
export function returnPosition(raw: string | null, now = Date.now()): ReturnPosition | null {
  try { const p = JSON.parse(raw ?? "null") as ReturnPosition; return p?.version === 1 && safePublicReturn(p.from) === p.from && /^[1-9][0-9]{1,24}$/.test(p.postId) && Number.isFinite(p.y) && p.y >= 0 && p.y <= 10000000 && typeof p.restore === "boolean" && Number.isFinite(p.at) && p.at <= now + 60000 && now - p.at < 24 * 60 * 60 * 1000 ? p : null; } catch { return null; }
}

export function publicReturnForPost(postId: string | undefined, explicit: unknown, stored: string | null): string | null {
  const provided = safePublicReturn(explicit);
  if (provided) return provided;
  const previous = returnPosition(stored);
  return postId && previous?.postId === postId && !previous.restore ? previous.from : null;
}

// Memory proof exists only after an actual same-tab list click. It cannot be
// recreated by a direct URL, a new tab or a detail-page reload.
let pendingHistory: { postId: string; from: string; historyLength: number; at: number } | null = null;
export function rememberPublicHistory(position: ReturnPosition | null) {
  pendingHistory = position?.navigation === "client" && Number.isSafeInteger(position.historyLength)
    ? { postId: position.postId, from: position.from, historyLength: position.historyLength!, at: position.at } : null;
}
export function canUsePublicHistory(position: ReturnPosition | null, postId: string | undefined, target: string,
  historyLength: number, referrer: string, currentOrigin: string) {
  if (!position || position.restore || position.postId !== postId || position.from !== target ||
      !Number.isSafeInteger(position.historyLength) || position.historyLength! < 1 || historyLength < 2) return false;
  if (position.navigation === "client") return pendingHistory?.postId === postId && pendingHistory.from === target &&
    pendingHistory.at === position.at && pendingHistory.historyLength === position.historyLength;
  if (position.navigation === "native") {
    try { const url = new URL(referrer); return url.origin === currentOrigin && safePublicReturn(url.pathname + url.search) === target; }
    catch { return false; }
  }
  return false;
}
