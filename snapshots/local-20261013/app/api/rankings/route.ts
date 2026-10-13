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
    const source = new URL(process.env.RANKINGS_SOURCE_URL?.trim() || "https://xcliprank.com/api/rankings");
    if (source.username || source.password || !["https:", "http:"].includes(source.protocol) ||
        !["xcliprank.com", "localhost", "127.0.0.1"].includes(source.hostname) || source.pathname !== "/api/rankings") throw Error("UNSUPPORTED_RANKING_SOURCE");
    source.search = req.nextUrl.search;
    const response = await fetch(source, { cache: "no-store", signal: AbortSignal.timeout(60000), redirect: "error" });
    const body = await response.json();
    if (response.ok && (body.ok !== true || (range === "author-status" ? !Array.isArray(body.blockedKeys) : !Array.isArray(body.data)))) throw Error("INVALID_RANKING_RESPONSE");
    return NextResponse.json(body, { status: response.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const invalid = error instanceof Error && error.message === "INVALID_RANKING_PAGE";
    return NextResponse.json({ ok: false, error: invalid ? "INVALID_RANKING_PAGE" : "RANKING_SOURCE_UNAVAILABLE" }, { status: invalid ? 400 : 503, headers: { "Cache-Control": "no-store" } });
  }
}
