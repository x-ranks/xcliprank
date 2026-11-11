import { renderVideoSitemap } from "../../lib/video-sitemap-pilot";
import { readVideoSitemapPilot } from "../../lib/video-sitemap-pilot-source";

export const dynamic = "force-dynamic";

export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  try {
    const xml = renderVideoSitemap(await readVideoSitemapPilot());
    if (!xml) return new Response(null, { status: 404, headers });
    return new Response(xml, { headers: { ...headers, "Content-Type": "application/xml; charset=utf-8" } });
  } catch {
    return new Response(null, { status: 503, headers: { ...headers, "Retry-After": "60" } });
  }
}
