import { issueSaveReceipt } from "../../../lib/public-save-receipt";
import { publicSaveSecret } from "../../../lib/public-save-secret";
import { supabaseAdmin } from "../../../lib/supabase-admin";
import { downloadVideo, type DownloadPost } from "../../../lib/video-download";
import { postForTicket } from "../../../lib/download-url";
import { downloadSecret } from "../../../lib/download-url-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return downloadVideo(request, {
    issueReceipt: async id => issueSaveReceipt(id, await publicSaveSecret()),
    async findPost(id) {
      const { data, error } = await supabaseAdmin().from("posts")
        .select("video_url,is_visible,moderation_blocked,review_required,content_category,adult_tier,manual_tier")
        .eq("x_post_id", id).maybeSingle();
      if (error) throw error;
      const post = data as DownloadPost | null;
      const token = new URL(request.url).searchParams.get("token");
      return token ? postForTicket(post, token, id, await downloadSecret()) : post;
    },
  });
}
