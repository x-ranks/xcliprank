import { NextRequest, NextResponse } from "next/server";
import { parseRankingPage } from "../../../lib/ranking-pagination";

export const runtime = "nodejs";

// The local public-page preview reads the deployed edition, rather than making a second DB ranking.
// Management routes keep their existing DB connection and authentication.
export async function GET(req: NextRequest) {
  const range = req.nextUrl.searchParams.get("range") ?? "trending";
  if (!["trending", "daily", "weekly", "author-status"].includes(range)) {
    return NextResponse.json({ ok: false, error: "INVALID_RANKING_RANGE" }, { status: 400 });
  }
  try {
    const page = req.nextUrl.searchParams.get("page");
    if (page != null) { parseRankingPage(page); if (range !== "trending") throw Error("INVALID_RANKING_PAGE"); }
    const source = new URL(process.env.RANKINGS_SOURCE_URL?.trim() || "https://twizou.net/api/rankings");
    if (source.username || source.password || !["https:", "http:"].includes(source.protocol) ||
        !["twizou.net", "xcliprank.com", "localhost", "127.0.0.1"].includes(source.hostname) || source.pathname !== "/api/rankings") throw Error("UNSUPPORTED_RANKING_SOURCE");
    // Existing local installations may still specify the old production host.
    if (source.hostname === "xcliprank.com") source.hostname = "twizou.net";
    source.search = req.nextUrl.search;
    const response = await fetch(source, { cache: "no-store", signal: AbortSignal.timeout(60000), redirect: "error" });
    const body = await response.json();
    if (response.ok && (body.ok !== true || (range === "author-status" ? !Array.isArray(body.blockedKeys) : !Array.isArray(body.data)))) throw Error("INVALID_RANKING_RESPONSE");
    const headers = new Headers({ "Cache-Control": "no-store" });
    for (const name of ["Server-Timing", "X-Twizou-Ranking-Cache", "X-Twizou-Ranking-Cache-Age-Ms"]) { const value = response.headers.get(name); if (value) headers.set(name, value); }
    return NextResponse.json(body, { status: response.status, headers });
  } catch (error) {
    const invalid = error instanceof Error && error.message === "INVALID_RANKING_PAGE";
    return NextResponse.json({ ok: false, error: invalid ? "INVALID_RANKING_PAGE" : "RANKING_SOURCE_UNAVAILABLE" }, { status: invalid ? 400 : 503, headers: { "Cache-Control": "no-store" } });
  }
}
