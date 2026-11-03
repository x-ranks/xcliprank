export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function stopped() {
  return Response.json({ error: "VIDEO_RELAY_DISABLED", message: "動画の中継配信は終了しました。配信元から直接再生してください。" }, { status: 410, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" } });
}
export async function GET(request: Request) {
  return stopped();
}
export async function HEAD() { return new Response(null, { status: 410, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" } }); }
