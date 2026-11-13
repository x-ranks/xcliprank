import { NextRequest, NextResponse } from "next/server";
import { EDGE_CACHE_CONTROL, edgeCacheable } from "./lib/edge-cache";

const CANONICAL_HOST = "twizou.net";
const REDIRECT_HOSTS = new Set([
  "xcliprank.com",
  "www.xcliprank.com",
  "www.twizou.net",
  "x-video-rank-mvp.vercel.app"
]);

const PUBLIC_EXACT_PATHS = new Set([
  "/api/public-video",
  "/api/discovery",
  "/discover",
  "/favorites",
  "/following",
  "/api/follow-feed",
  "/api/push",
  "/api/push/send",
  "/api/manual-ranking",
  "/api/public-label-admin",
  "/api/public-save-event",
  "/api/video-playback-url",
  "/",
  "/ranking/daily",
  "/ranking/weekly",
  "/rising",
  "/reels",
  "/browse",
  "/accounts",
  "/tags",
  "/months",
  "/api/rankings",
  "/api/reels",
  "/api/video",
  "/api/video-download",
  "/api/video-resolve",
  "/download",
  "/download-policy",
  "/api/engagement",
  "/api/engagement-stats",
  "/removal-request",
  "/privacy",
  "/terms",
  "/contact",
  "/copyright",
  "/advertising-disclosure",
  "/api/removal-requests",
  "/api/contact-requests",
  "/api/collect",
  "/api/curated-authors",
  "/api/collect-curated-author",
  "/api/collect-curated-batch",
  "/api/free-curated-sync",
  "/api/x-promotion",
  "/api/x-api-usage",
  "/favicon.ico",
  "/robots.txt",
  "/sitemap.xml",
]);

const NOINDEX_PATHS = new Set([
  "/removal-request",
  "/privacy",
  "/terms",
  "/contact",
  "/copyright",
  "/advertising-disclosure"
]);

function isPublicPath(pathname: string) {
  if (/^\/p\/[1-9][0-9]{1,24}\/?$/.test(pathname) || /^\/accounts\/[A-Za-z0-9_-]{1,68}\/?$/.test(pathname) || /^\/tags\/[^/]{1,500}\/?$/.test(pathname) || /^\/months\/\d{4}-(0[1-9]|1[0-2])\/?$/.test(pathname)) return true;
  if (PUBLIC_EXACT_PATHS.has(pathname)) {
    return true;
  }

  if (
    pathname.startsWith("/_next/static/") ||
    pathname.startsWith("/_next/image")
  ) {
    return true;
  }

  // Files served as ordinary static assets remain publicly reachable.
  return /\.[^/]+$/.test(pathname);
}

export function middleware(request: NextRequest) {
  if (process.env.NODE_ENV !== "production") {
    return NextResponse.next();
  }

  if (REDIRECT_HOSTS.has(request.nextUrl.hostname)) {
    // Keep legacy API callers working while moving public pages to twizou.net.
    if (request.nextUrl.pathname.startsWith("/api/")) return NextResponse.next();
    const canonicalUrl = request.nextUrl.clone();
    canonicalUrl.protocol = "https";
    canonicalUrl.hostname = CANONICAL_HOST;
    canonicalUrl.port = "";
    return NextResponse.redirect(canonicalUrl, 301);
  }

  // Old list links carried "?from=<list>" on video pages. Return context now lives in
  // sessionStorage, so those URLs are pure duplicates. Redirect them (instead of blocking them
  // in robots.txt) so Google can follow the 301 and consolidate onto the clean URL.
  const legacyPost = request.nextUrl.pathname.match(/^\/p\/([1-9][0-9]{1,24})\/?$/);
  if (legacyPost && request.nextUrl.searchParams.has("from")) {
    // Built from scratch (not NextURL.clone) so a trailing slash on the request is not carried over.
    const cleanUrl = new URL("/p/" + legacyPost[1], "https://" + CANONICAL_HOST);
    request.nextUrl.searchParams.forEach((value, key) => {
      if (key !== "from") cleanUrl.searchParams.append(key, value);
    });
    return NextResponse.redirect(cleanUrl, 301);
  }

  if (isPublicPath(request.nextUrl.pathname)) {
    const response = NextResponse.next();
    response.headers.set("Referrer-Policy", "same-origin");
    if (edgeCacheable(request.method, request.nextUrl.pathname, request.headers.get("user-agent"), request.headers.get("x-twizou-verified-googlebot"))) {
      response.headers.set("Cache-Control", EDGE_CACHE_CONTROL);
    }

    if (
      request.nextUrl.pathname.startsWith("/api/") ||
      NOINDEX_PATHS.has(request.nextUrl.pathname)
    ) {
      response.headers.set(
        "X-Robots-Tag",
        "noindex, nofollow, noarchive"
      );
    }

    return response;
  }

  return new NextResponse(null, { status: 404 });
}

