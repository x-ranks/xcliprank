import { NextRequest, NextResponse } from "next/server";

const CANONICAL_HOST = "xcliprank.com";
const REDIRECT_HOSTS = new Set([
  "www.xcliprank.com",
  "x-video-rank-mvp.vercel.app"
]);

const PUBLIC_EXACT_PATHS = new Set([
  "/",
  "/ranking/daily",
  "/ranking/weekly",
  "/reels",
  "/api/rankings",
  "/api/reels",
  "/api/video",
  "/api/video-resolve",
  "/download",
  "/api/video-download",
  "/download-policy",
  "/api/engagement",
  "/api/engagement-stats",
  "/removal-request",
  "/api/removal-requests",
  "/api/collect",
  "/api/curated-authors",
  "/api/collect-curated-author",
  "/api/collect-curated-batch",
  "/api/x-promotion",
  "/api/x-api-usage",
  "/favicon.ico",
  "/robots.txt",
  "/sitemap.xml",
]);

const NOINDEX_PATHS = new Set([
  "/removal-request"
]);

function isPublicPath(pathname: string) {
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
    const canonicalUrl = request.nextUrl.clone();
    canonicalUrl.protocol = "https";
    canonicalUrl.hostname = CANONICAL_HOST;
    canonicalUrl.port = "";
    return NextResponse.redirect(canonicalUrl, 308);
  }

  if (isPublicPath(request.nextUrl.pathname)) {
    const response = NextResponse.next();

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
