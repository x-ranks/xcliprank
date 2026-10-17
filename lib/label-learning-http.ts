export function allowLabelRequest(request: Request, production = process.env.NODE_ENV === "production") {
  if (production) return false;
  try {
    const url = new URL(request.url), host = request.headers.get("host") ?? url.host;
    if (host !== url.host || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !["http:", "https:"].includes(url.protocol)) return false;
    if (["cross-site", "same-site"].includes(request.headers.get("sec-fetch-site") ?? "")) return false;
    const origin = request.headers.get("origin");
    if (request.method !== "GET" && !origin) return false;
    return !origin || new URL(origin).origin === url.origin;
  } catch { return false; }
}
export const labelHeaders = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow, noarchive" };
export function labelError(error: unknown) {
  const code = error instanceof Error && /^LABEL_[A-Z_]+$/.test(error.message) ? error.message : "LABEL_PROCESS_FAILED";
  const messages: Record<string, string> = {
    LABEL_BUSY: "別のラベル処理が実行中です。完了後に再試行してください。",
    LABEL_STALE_SCREEN: "別タブで更新されています。「記録を更新」後に操作してください。",
    LABEL_STATE_CORRUPT: "ラベル保存データを読めません。上書きせず、バックアップを確認してください。",
    LABEL_CREATE_FIRST: "先にラベルを作成してください。",
    LABEL_NO_CANDIDATES: "候補最大2,000件に未準備の対象がありません。投稿IDを指定するか、時間をおいて再試行してください。",
    LABEL_NO_UNSEEN_TEST_CANDIDATES: "候補最大2,000件に、学習に使っていない投稿者の新しい動画がありません。時間をおくか、未学習の投稿者の投稿IDを指定してください。",
    LABEL_TEST_AUTHOR_NOT_UNSEEN: "この投稿者は学習使用済み、または精度確認用として確保済みです。別の投稿者を選んでください。",
    LABEL_VIDEO_LIMIT: "画像準備は合計300動画までです。学習用100動画に加えて精度確認用を準備できます。",
    LABEL_NEEDS_TEN: "学習用として正解を保存した動画が10件必要です。",
    LABEL_EXAMPLES_MISSING: "各ラベルに該当・非該当それぞれ2件以上の教材が必要です。",
    LABEL_RETRAIN_REQUIRED: "未学習、または教材が変更されています。学習を実行してください。",
    LABEL_BLIND_TEST_NEEDED: "学習未使用で、予測を見る前に正解を保存した確認用動画が必要です。",
    LABEL_DUPLICATE_VIDEO: "同じ動画が準備済みです。重複を教材へ追加しませんでした。",
    LABEL_ALREADY_PREPARED: "この動画は準備済みです。",
    LABEL_VIDEO_TOO_LARGE: "動画が96MiBを超えています。今回は取得を見送りました。",
    LABEL_VIDEO_TOOLS_MISSING: "FFmpeg／FFprobeを使用できません。既存Tier学習の動画準備が動く設定を確認し、管理画面を再起動してください。",
    LABEL_VIDEO_FETCH_FAILED: "動画を取得できませんでした。別の動画を試してください。",
    LABEL_DUPLICATE_NAME: "同じ名前のラベルがあります。",
    LABEL_SOURCE_CHANGED: "準備中に対象の掲載条件または動画URLが変わったため保存を見送りました。"
  };
  return { error: messages[code] ?? "処理を完了できませんでした。再試行しても続く場合はエラーコードを共有してください。", code };
}
