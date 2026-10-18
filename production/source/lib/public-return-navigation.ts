const origin = "https://xcliprank.com";
export const RETURN_STORAGE_KEY = "xclip-public-return-v1";
export function safePublicReturn(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 1600 || !raw.startsWith("/") || raw.startsWith("//") || /[\\\u0000-\u0020\u007f]/.test(raw)) return null;
  try {
    const u = new URL(raw, origin); if (u.origin !== origin || u.hash) return null;
    if (!(["/", "/ranking/daily", "/ranking/weekly", "/reels"].includes(u.pathname) || /^\/accounts\/[A-Za-z0-9_-]{1,68}$/.test(u.pathname) || /^\/tags\/[^/]{1,500}$/.test(u.pathname))) return null;
    const query = new URLSearchParams();
    for (const key of u.searchParams.keys()) if (!["page", "edition"].includes(key) || u.searchParams.getAll(key).length !== 1) return null;
    const page = u.searchParams.get("page"), edition = u.searchParams.get("edition");
    if (page !== null) { if (u.pathname !== "/" || !/^(?:[1-9]|10)$/.test(page)) return null; if (page !== "1") query.set("page", page); }
    if (edition !== null) { if (!/^[A-Za-z0-9_-]{1,160}$/.test(edition)) return null; query.set("edition", edition); }
    return u.pathname + (query.size ? "?" + query.toString() : "");
  } catch { return null; }
}
export function publicDetailHref(id: string, from: string) {
  if (!/^[1-9][0-9]{1,24}$/.test(id)) throw Error("PUBLIC_INVALID_ID");
  return "/p/" + id + "?from=" + encodeURIComponent(safePublicReturn(from) ?? "/");
}
export type ReturnPosition = { version: 1; from: string; postId: string; y: number; at: number; restore: boolean };
export function returnPosition(raw: string | null, now = Date.now()): ReturnPosition | null {
  try { const p = JSON.parse(raw ?? "null") as ReturnPosition; return p?.version === 1 && safePublicReturn(p.from) === p.from && /^[1-9][0-9]{1,24}$/.test(p.postId) && Number.isFinite(p.y) && p.y >= 0 && p.y <= 10000000 && typeof p.restore === "boolean" && Number.isFinite(p.at) && p.at <= now + 60000 && now - p.at < 24 * 60 * 60 * 1000 ? p : null; } catch { return null; }
}
