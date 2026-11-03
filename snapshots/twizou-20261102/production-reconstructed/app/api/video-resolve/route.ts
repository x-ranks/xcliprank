import { supabaseAdmin } from "../../../lib/supabase-admin";
import { DownloadError, resolvePostUrl } from "../../../lib/download-url";
import { lookupPublicVideo, downloadSecret } from "../../../lib/download-url-store";
import type { DownloadPost } from "../../../lib/video-download";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow, noarchive" };
  try {
    const origin = request.headers.get("origin");
    // Apache/Passenger can forward HTTPS as an internal HTTP request.
    if (origin) {
      let originUrl: URL;
      try { originUrl = new URL(origin); } catch { throw new DownloadError(403, "同じサイトの保存ページから操作してください。"); }
      const host = request.headers.get("host") ?? new URL(request.url).host;
      if (!["https:", "http:"].includes(originUrl.protocol) || originUrl.host !== host) throw new DownloadError(403, "同じサイトの保存ページから操作してください。");
    }
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = []; let size = 0;
    if (reader) {
      try {
        while (true) {
          const part = await reader.read(); if (part.done) break;
          size += part.value.byteLength;
          if (size > 4096) { await reader.cancel(); throw new DownloadError(400, "投稿URLが長すぎます。"); }
          chunks.push(part.value);
        }
      } finally { reader.releaseLock(); }
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    let body: any;
    try { body = JSON.parse(raw); } catch { throw new DownloadError(400, "投稿URLを確認してください。"); }
    if (body.consent !== true) throw new DownloadError(400, "保存前に注意事項に同意してください。");
    const result = await resolvePostUrl(body.url, {
      async findPost(id) {
        const { data, error } = await supabaseAdmin().from("posts")
          .select("video_url,is_visible,moderation_blocked,review_required,content_category,adult_tier,manual_tier")
          .eq("x_post_id", id).maybeSingle();
        if (error) throw new DownloadError(503, "掲載可否の確認に失敗しました。DB接続・設定を確認してください。（DB_LOOKUP_FAILED）");
        return data as DownloadPost | null;
      }, lookup: lookupPublicVideo, async secret() {
        try { return await downloadSecret(); }
        catch { throw new DownloadError(503, "保存用情報を作成できません。状態フォルダの書き込み権限を確認してください。（DOWNLOAD_STATE_FAILED）"); }
      },
    });
    return Response.json({ ok: true, ...result }, { headers });
  } catch (error) {
    const status = error instanceof DownloadError ? error.status : 502;
    const message = error instanceof DownloadError ? error.message : "取得できませんでした。時間をおいて再試行してください。（RESOLVE_INTERNAL）";
    console.info(JSON.stringify({ feature: "video_resolve", outcome: "error", status,
      code: message.match(/\(([A-Z0-9_]+)\)|（([A-Z0-9_]+)）/)?.slice(1).find(Boolean) ?? "RESOLVE_REJECTED", paid_x_requests: 0 }));
    return Response.json({ ok: false, error: message },
      { status: error instanceof DownloadError ? error.status : 502, headers });
  }
}
