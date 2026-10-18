import { allowLabelRequest, labelHeaders } from "../../../lib/label-learning-http";
import { boundedJson } from "../../../lib/public-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
function failure(e: unknown) {
  const code = e instanceof Error && /^LABEL_(?:AUTO|PUBLIC)_[A-Z_]+$/.test(e.message) ? e.message : "LABEL_AUTO_PROCESS_FAILED";
  const messages: Record<string, string> = { LABEL_AUTO_BUSY: "別タブの処理が実行中です。今の1件が終わってから再開してください。", LABEL_AUTO_STALE: "別タブで記録が更新されました。記録を更新して再開してください。", LABEL_AUTO_MODEL_CHANGED: "学習モデルが変わりました。新しい一周を開始してください。", LABEL_AUTO_MODEL_NOT_READY: "100教材以上のモデルで学習を完了してください。", LABEL_AUTO_DEPLOY_FIRST: "先に本番の自動ラベル対応更新を適用してください。", LABEL_AUTO_UNREADABLE: "自動処理の記録を読めません。上書きせずエラーコードを共有してください。", LABEL_PUBLIC_AUTH_FAILED: "本番の認証設定を確認してください。秘密の値は共有しないでください。" };
  return Response.json({ error: messages[code] ?? "処理を完了できませんでした。記録を更新して続きから再開してください。", code }, { status: 400, headers: labelHeaders });
}
export async function GET(request: Request) {
  if (!allowLabelRequest(request)) return new Response(null, { status: 404, headers: labelHeaders });
  try { return Response.json(await (await import("../../../lib/label-auto-server")).autoLabels.status(), { headers: labelHeaders }); } catch (e) { return failure(e); }
}
export async function POST(request: Request) {
  if (!allowLabelRequest(request)) return new Response(null, { status: 404, headers: labelHeaders });
  try { const body = await boundedJson(request, 2048); return Response.json(await (await import("../../../lib/label-auto-server")).autoLabels.mutate(body), { headers: labelHeaders }); } catch (e) { return failure(e); }
}
