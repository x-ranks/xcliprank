// Short edge caching for anonymous list pages. Cloudflare keeps the HTML for s-maxage seconds (browsers always revalidate).
// Never for crawlers: the verified-Googlebot header and any "google" user agent get the normal uncached response, so a
// cached human page can never be served to Googlebot (and the reverse).
export const EDGE_CACHE_CONTROL = "public, max-age=0, s-maxage=60, stale-while-revalidate=300";
const EXACT = new Set(["/rising", "/browse", "/months", "/reels", "/accounts"]);
const PREFIXES = ["/ranking/", "/tags/", "/months/", "/accounts/"];
export function edgeCacheable(method: string, pathname: string, userAgent: string | null, verifiedGooglebot: string | null): boolean {
  if (method !== "GET" && method !== "HEAD") return false;
  if (verifiedGooglebot !== null || (userAgent ?? "").toLowerCase().includes("google")) return false;
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return EXACT.has(path) || PREFIXES.some(prefix => path.startsWith(prefix) && path.length > prefix.length);
}
