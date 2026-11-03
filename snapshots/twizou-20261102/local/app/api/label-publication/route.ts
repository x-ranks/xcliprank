import { allowLabelRequest, labelHeaders } from "../../../lib/label-learning-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
function error(e: unknown) { const code = e instanceof Error && /^LABEL_PUBLIC_[A-Z_]+$/.test(e.message) ? e.message : "LABEL_PUBLIC_PROCESS_FAILED"; return { error: code === "LABEL_PUBLIC_DEPLOY_FIRST" ? "先に本番のラベル・個別URL更新を適用してください。" : code === "LABEL_PUBLIC_TRAIN_FIRST" ? "100件以上の保存済み教材で学習し直してください。" : code === "LABEL_PUBLIC_NOTHING_APPROVED" ? "反映できる確認済みラベルがありません。" : code === "LABEL_PUBLIC_AUTH_FAILED" ? "本番の認証設定が一致しません。CRON_SECRETの値を共有せず設定場所を確認してください。" : "処理を完了できませんでした。記録を更新して再試行してください。", code }; }
export async function GET(request: Request) {
  if (!allowLabelRequest(request)) return new Response(null, { status: 404, headers: labelHeaders });
  try { return Response.json(await (await import("../../../lib/label-publication-server")).labelPublication.status(), { headers: labelHeaders }); } catch (e) { return Response.json(error(e), { status: 400, headers: labelHeaders }); }
}
export async function POST(request: Request) {
  if (!allowLabelRequest(request)) return new Response(null, { status: 404, headers: labelHeaders });
  try { const reader = request.body?.getReader(); if (!reader || !request.headers.get("content-type")?.startsWith("application/json")) throw Error("LABEL_PUBLIC_INVALID_INPUT"); const chunks: Uint8Array[] = []; let size = 0;
    try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 32768) throw Error("LABEL_PUBLIC_INVALID_INPUT"); chunks.push(value); } } finally { await reader.cancel(); }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")); return Response.json(await (await import("../../../lib/label-publication-server")).labelPublication.mutate(body), { headers: labelHeaders });
  } catch (e) { return Response.json(error(e), { status: 400, headers: labelHeaders }); }
}
