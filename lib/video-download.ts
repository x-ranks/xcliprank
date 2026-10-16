// Keep downloads independent of playback/metadata helpers that may only be on the server.
export function isAllowedDownloadUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === "https:" && !url.username && !url.password &&
      (!url.port || url.port === "443") &&
      (url.hostname === "video.twimg.com" || url.hostname.endsWith(".video.twimg.com"));
  } catch { return false; }
}

export type DownloadPost = {
  video_url: string | null;
  is_visible: boolean;
  moderation_blocked: boolean;
  review_required: boolean;
  content_category: string | null;
  adult_tier: string | null;
  manual_tier: string | null;
};

export function canDownloadPost(post: DownloadPost | null) {
  return !!post && post.is_visible === true && post.moderation_blocked === false &&
    post.review_required === false && post.content_category === "PASS" &&
    ["S", "A+", "A", "B+", "B", "C"].includes(post.manual_tier ?? post.adult_tier ?? "") &&
    !!post.video_url && isAllowedDownloadUrl(post.video_url);
}

type Dependencies = {
  findPost: (id: string) => Promise<DownloadPost | null>;
  fetcher?: typeof fetch;
};

// Metadata only. Never fetch or stream CDN bytes on the Xclip server.
export async function downloadVideo(request: Request, deps: Dependencies): Promise<Response> {
  const url = new URL(request.url);
  const id = url.searchParams.get("postId") ?? "";
  const checking = url.searchParams.get("check") === "1";
  const headers = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow, noarchive" };
  const fail = (status: number, error: string) => Response.json({ error }, { status, headers });
  if (!/^[0-9]{1,25}$/.test(id)) return fail(400, "投稿IDが正しくありません。");
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      const parsed = new URL(origin);
      if (!["http:", "https:"].includes(parsed.protocol) || parsed.host !== (request.headers.get("host") ?? url.host)) {
        return fail(403, "同じサイトの保存画面から操作してください。");
      }
    } catch { return fail(403, "同じサイトの保存画面から操作してください。"); }
  }
  if (!checking && url.searchParams.get("consent") !== "1") return fail(400, "保存前に注意事項を確認し、同意してください。");
  if (request.signal.aborted) return fail(499, "操作を中止しました。");
  try {
    const post = await deps.findPost(id);
    if (!canDownloadPost(post)) return fail(404, "この投稿は保存対象外、非公開、または除外済みです。");
    if (request.signal.aborted) return fail(499, "操作を中止しました。");
    return Response.json({ ready: true, mode: "browser-direct", ...(checking ? {} : {
      url: post!.video_url, filename: `xclip-${id}.mp4`,
    }) }, { headers });
  } catch { return fail(502, "保存情報を取得できませんでした。時間をおいて再試行してください。"); }
}
