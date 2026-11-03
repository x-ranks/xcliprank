export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { cachedVideoDuration, isAllowedVideoUrl } from "../../../lib/video-duration";

function stopped() {
  return Response.json({ error: "VIDEO_RELAY_DISABLED", message: "動画の中継配信は終了しました。配信元から直接再生してください。" }, { status: 410, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" } });
}
export async function GET(request: Request) {
  const url = new URL(request.url), raw = url.searchParams.get("url");
  if (url.searchParams.get("metadata") === "1") {
    if (!raw || !isAllowedVideoUrl(raw)) return Response.json({ error: "INVALID_VIDEO_URL" }, { status: 400, headers: { "Cache-Control": "no-store" } });
    const durationSeconds = await cachedVideoDuration(raw);
    return Response.json({ durationSeconds }, { headers: { "Cache-Control": `public, max-age=${durationSeconds === null ? 300 : 3600}` } });
  }
  return stopped();
}
export async function HEAD() { return new Response(null, { status: 410, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" } }); }
