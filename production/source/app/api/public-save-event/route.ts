import { boundedJson } from "../../../lib/public-http";
import { productionPublicBackend } from "../../../lib/public-video-production";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow, noarchive" };
export async function POST(request: Request) {
  try {
    const origin = request.headers.get("origin"), url = new URL(request.url);
    if (!origin || !(["https://xcliprank.com", "https://www.xcliprank.com"].includes(new URL(origin).origin) || (process.env.NODE_ENV !== "production" && new URL(origin).origin === url.origin)) || ["cross-site", "same-site"].includes(request.headers.get("sec-fetch-site") ?? "")) return Response.json({ ok: false }, { status: 403, headers });
    const data = await boundedJson(request, 2048); const result = await productionPublicBackend().service.saved(data.id, data.receipt); return Response.json(result, { headers });
  } catch { return Response.json({ ok: false }, { status: 400, headers }); }
}
