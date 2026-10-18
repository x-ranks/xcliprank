import { supabaseAdmin } from "../../../lib/supabase-admin";
import { fetchFreePlaybackMedia } from "../../../lib/download-free";
import { DownloadError } from "../../../lib/download-url";
import type { DownloadPost } from "../../../lib/video-download";
import { refreshPlaybackSources } from "../../../lib/playback-refresh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const cached = new Map<string, { until: number; promise: ReturnType<typeof fetchFreePlaybackMedia> }>();
let windowUntil = 0, lookups = 0;
function freeLookup(id: string) {
  const now = Date.now(), hit = cached.get(id);
  if (hit && hit.until > now) return hit.promise;
  if (now >= windowUntil) { windowUntil = now + 60000; lookups = 0; }
  if (++lookups > 60) throw new DownloadError(429, "再生URLの更新が混み合っています。1分後に再試行してください。（PLAYBACK_RATE_LIMIT）");
  const promise = fetchFreePlaybackMedia(id);
  const entry = { until: now + 600000, promise };
  cached.set(id, entry);
  void promise.catch(() => { if (cached.get(id) === entry) entry.until = Date.now() + 60000; });
  if (cached.size > 512) cached.delete(cached.keys().next().value!);
  return promise;
}
export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow, noarchive" };
  try {
    const requestUrl = new URL(request.url);
    const origin = request.headers.get("origin");
    if (origin && new URL(origin).host !== (request.headers.get("host") ?? requestUrl.host))
      throw new DownloadError(403, "同じサイトから操作してください。（PLAYBACK_ORIGIN）");
    const sources = await refreshPlaybackSources(requestUrl.searchParams.get("postId") ?? "", {
      async findPost(id) {
        const { data, error } = await supabaseAdmin().from("posts")
          .select("video_url,is_visible,moderation_blocked,review_required,content_category,adult_tier,manual_tier")
          .eq("x_post_id", id).maybeSingle();
        if (error) throw new DownloadError(503, "掲載情報を確認できません。（PLAYBACK_DB_FAILED）");
        return data as DownloadPost | null;
      }, lookup: freeLookup,
    });
    // JSON metadata only; this route never fetches video bytes or writes the DB.
    return Response.json({ ...sources, mode: "browser-direct" }, { headers });
  } catch (error) {
    return Response.json({ error: error instanceof DownloadError ? error.message : "無料の再生URL更新に失敗しました。（PLAYBACK_REFRESH_FAILED）" },
      { status: error instanceof DownloadError ? error.status : 502, headers });
  }
}
