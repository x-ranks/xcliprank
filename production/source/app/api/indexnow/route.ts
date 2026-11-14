import { runIndexNow } from "../../../lib/indexnow";
import { publicCatalogDirectory } from "../../../lib/public-save-secret";
import sitemap from "../../sitemap";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;
const headers = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" };
/**
 * Called by a server cron job. Announces new/changed pages from our own sitemap to IndexNow.
 * No secret is needed: the caller cannot choose any URL, and runs are spaced out by a state file,
 * so repeated calls only return "skipped".
 */
export async function POST() {
  try {
    const summary = await runIndexNow({ rows: () => sitemap(), dir: publicCatalogDirectory() });
    return Response.json({ ok: true, ...summary }, { headers });
  } catch { return Response.json({ ok: false }, { status: 503, headers }); }
}
