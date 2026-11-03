import { productionPublicBackend } from "../../../lib/public-video-production";
import type { NextRequest } from "next/server";
import { GET as readManualRanking } from "../manual-ranking/route";
import { readManualState } from "../../../lib/manual-ranking";
import { readPublishedManualThumbnail } from "../../../lib/manual-thumbnail-store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow, noarchive" };
export async function GET(request: NextRequest) {
  const url = new URL(request.url), type = url.searchParams.get("type"), value = url.searchParams.get("value") ?? "";
  if (type === "placement") return readManualRanking(request);
  if (type === "manual-thumbnail") {
    if (!/^[a-f0-9]{64}$/.test(value)) return new Response(null, { status: 404, headers });
    try {
      const state = await readManualState();
      const bytes = await readPublishedManualThumbnail(value, state.entries);
      if (!bytes) return new Response(null, { status: 404, headers });
      return new Response(new Uint8Array(bytes), { headers: { ...headers, "Content-Type": "image/webp", "X-Content-Type-Options": "nosniff" } });
    } catch { return new Response(null, { status: 503, headers }); }
  }
  const rawPage = url.searchParams.get("page"), page = rawPage === null ? 1 : Number(rawPage);
  if (value.length > 160 || !Number.isInteger(page) || page < 1 || page > 9999) return Response.json({ ok: false }, { status: 400, headers });
  try {
    const s = productionPublicBackend({ readOnlyRender: true }).service;
    const data = type === "detail-core" ? await s.detailCore(value) : type === "related" ? await (async () => { const core = await s.detailCore(value); return core ? s.detailRelated(core) : null; })() : type === "detail" ? await s.detail(value) : type === "account" ? await s.account(value, page) : type === "tag" ? await s.tag(value, page) : type === "labels" ? await s.activeLabels() : type === "sitemap" ? await s.indexable() : type === "browse" ? await s.browse(page) : undefined;
    return data === undefined ? Response.json({ ok: false }, { status: 400, headers }) : Response.json({ ok: true, data }, { headers });
  } catch { return Response.json({ ok: false, error: "PUBLIC_READ_UNAVAILABLE" }, { status: 503, headers }); }
}
