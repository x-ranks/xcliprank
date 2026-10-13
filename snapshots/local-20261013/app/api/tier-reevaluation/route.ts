import { NextRequest, NextResponse } from "next/server";
import { runReevaluation, reevaluationStatus } from "../../../lib/tier-reevaluation";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function allowed(request: NextRequest) {
  if (process.env.NODE_ENV === "production") return false;
  try {
    // Next dev can normalize nextUrl to localhost while the browser uses 127.0.0.1.
    // Compare the browser's Origin to the actual HTTP Host, not the internal URL.
    const host = new URL("http://" + (request.headers.get("host") ?? request.nextUrl.host));
    if (!["localhost", "127.0.0.1", "[::1]"].includes(host.hostname)) return false;
    const origin = request.headers.get("origin");
    if (origin && new URL(origin).origin !== host.origin) return false;
    return !["cross-site", "same-site"].includes(request.headers.get("sec-fetch-site") ?? "");
  } catch { return false; }
}
function denied() {
  return NextResponse.json({ error: "ローカルアクセスの確認に失敗しました。http://127.0.0.1:3004/tier-reevaluation を開き、開発サーバーを再起動してください。" }, { status: 404 });
}
export async function GET(request: NextRequest) {
  if (!allowed(request)) return denied();
  try { return NextResponse.json(await reevaluationStatus(), { headers: {"Cache-Control": "no-store"} }); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "確認に失敗しました。" }, { status: 500 }); }
}
export async function POST(request: NextRequest) {
  if (!allowed(request)) return denied();
  if (!request.headers.get("content-type")?.startsWith("application/json")) return NextResponse.json({ error: "JSON required" }, { status: 415 });
  try {
    const body = await request.json();
    await runReevaluation(body.action, body.id);
    return NextResponse.json(await reevaluationStatus());
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "処理に失敗しました。続行できます。" }, { status: 400 }); }
}
