import { productionPublicBackend } from "../../../lib/public-video-production";
import { selectDiscovery, type DiscoveryMode, type DiscoveryQuery } from "../../../lib/discovery-index";
import { readDiscoveryIds } from "../../../lib/discovery-request";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" };
export async function GET(request: Request) {
  const p = new URL(request.url).searchParams;
  const mode = p.get("mode");
  if (!mode || !["search", "month", "months", "tier", "random"].includes(mode)) return Response.json({ ok: false }, { status: 400, headers });
  const offsetText = p.get("offset") ?? "0", seedText = p.get("seed") ?? "0";
  if (!/^\d{1,5}$/.test(offsetText) || !/^\d{1,10}$/.test(seedText)) return Response.json({ ok: false }, { status: 400, headers });
  const query: DiscoveryQuery = { mode: mode as DiscoveryMode, query: p.get("q") ?? "", month: p.get("month") ?? "", tier: p.get("tier") ?? "", offset: Number(offsetText), seed: Number(seedText) };
  try { selectDiscovery({ entries: [], months: [] }, query); return Response.json({ ok: true, data: await productionPublicBackend({ readOnlyRender: true }).service.discovery(query) }, { headers }); }
  catch (error) { const invalid = error instanceof Error && error.message.startsWith("INVALID_DISCOVERY_"); return Response.json({ ok: false }, { status: invalid ? 400 : 503, headers }); }
}
export async function POST(request: Request) {
  let ids: string[];
  try { ids = await readDiscoveryIds(request); } catch { return Response.json({ ok: false }, { status: 400, headers }); }
  try {
    return Response.json({ ok: true, videos: await productionPublicBackend({ readOnlyRender: true }).service.personalVideos(ids) }, { headers });
  } catch { return Response.json({ ok: false }, { status: 503, headers }); }
}
