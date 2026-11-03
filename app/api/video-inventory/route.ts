import { allowLabelRequest, labelHeaders } from "../../../lib/label-learning-http";
import { countVideoInventory, type VideoInventory } from "../../../lib/video-inventory";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
let cached: { until: number; value: Promise<VideoInventory> } | null = null;
export async function GET(request: Request) {
  if (!allowLabelRequest(request)) return new Response(null, { status: 404, headers: labelHeaders });
  try {
    if (!cached || Date.now() >= cached.until) {
      const value = import("../../../lib/supabase-admin").then(({ supabaseAdmin }) => countVideoInventory(supabaseAdmin()));
      const current = { until: Date.now() + 300000, value }; cached = current;
      value.catch(() => { if (cached === current) cached = null; });
    }
    return Response.json({ ok: true, ...await cached.value }, { headers: labelHeaders });
  } catch { return Response.json({ ok: false, error: "件数を取得できませんでした。時間をおいて再試行してください。" }, { status: 503, headers: labelHeaders }); }
}
