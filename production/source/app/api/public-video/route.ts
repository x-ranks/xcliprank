import { productionPublicBackend } from "../../../lib/public-video-production";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow, noarchive" };
export async function GET(request: Request) {
  const url = new URL(request.url), type = url.searchParams.get("type"), value = url.searchParams.get("value") ?? "";
  if (value.length > 160) return Response.json({ ok: false }, { status: 400, headers });
  try {
    const s = productionPublicBackend().service;
    const data = type === "detail" ? await s.detail(value) : type === "account" ? await s.account(value) : type === "tag" ? await s.tag(value) : type === "sitemap" ? await s.indexable() : undefined;
    return data === undefined ? Response.json({ ok: false }, { status: 400, headers }) : Response.json({ ok: true, data }, { headers });
  } catch { return Response.json({ ok: false, error: "PUBLIC_READ_UNAVAILABLE" }, { status: 503, headers }); }
}
