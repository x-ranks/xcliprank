import { productionPublicBackend } from "../../../lib/public-video-production";
import { readFollowKeys } from "../../../lib/follow-request";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" };
export async function POST(request: Request) {
  let keys: string[];
  try { keys = await readFollowKeys(request); } catch { return Response.json({ ok: false }, { status: 400, headers }); }
  try {
    const feed = await productionPublicBackend({ readOnlyRender: true }).service.followFeed(keys);
    return Response.json({ ok: true, ...feed }, { headers });
  } catch { return Response.json({ ok: false }, { status: 503, headers }); }
}
