import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { parseManualPlacement, readManualState, writeManualState } from "../../../lib/manual-ranking";
import { productionPublicBackend } from "../../../lib/public-video-production";
import { readManualRequestBody } from "../../../lib/manual-request-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" };
const json = (body: object, status = 200) => NextResponse.json(body, { status, headers });
const readEndpoint = "https://twizou.net/api/public-video?type=placement";
const writeEndpoint = "https://twizou.net/api/engagement?type=placement";

function authorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = request.headers.get("authorization");
  if (!secret || !given) return false;
  const a = Buffer.from(given), b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}
function localRequest(request: NextRequest) {
  return process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1", "::1"].includes(request.nextUrl.hostname);
}
async function forward(request: NextRequest, body?: string) {
  const authorization = request.headers.get("authorization");
  if (!authorization) return json({ ok: false, error: "管理キーを入力してください。" }, 401);
  const response = await fetch(body === undefined ? readEndpoint : writeEndpoint, {
    method: body === undefined ? "GET" : "POST", redirect: "error", cache: "no-store",
    headers: { Authorization: authorization, ...(body === undefined ? {} : { "Content-Type": "application/json", Origin: "https://twizou.net" }) },
    body, signal: AbortSignal.timeout(75000),
  });
  if (!response.headers.get("content-type")?.includes("application/json")) return json({ ok: false, error: "本番APIが未適用です。" }, 502);
  if (response.status === 401) return json({ ok: false, error: "本番の管理キーが一致しません。管理キーを変更して再試行してください。" }, 401);
  const payload = await response.json();
  return json(payload, response.status);
}
export async function GET(request: NextRequest) {
  try {
    if (localRequest(request)) return await forward(request);
    if (!authorized(request)) return json({ ok: false, error: "認証が必要です。" }, 401);
    const state = await readManualState();
    return json({ ok: true, state });
  } catch { return json({ ok: false, error: "登録状態を取得できません。" }, 503); }
}
export async function POST(request: NextRequest) {
  if (!localRequest(request) && !authorized(request)) return json({ ok: false, error: "認証が必要です。" }, 401);
  if (!request.headers.get("content-type")?.startsWith("application/json")) return json({ ok: false, error: "JSONのみ受け付けます。" }, 415);
  try {
    const raw = await readManualRequestBody(request);
    if (localRequest(request)) {
      const origin = request.headers.get("origin");
      if (origin !== request.nextUrl.origin) return json({ ok: false, error: "ローカル画面から操作してください。" }, 403);
      return await forward(request, raw);
    }
    const body = JSON.parse(raw);
    if (body.action === "save") {
      const candidate = parseManualPlacement(body.entry);
      const xId = candidate.url.match(/(?:x\.com|twitter\.com)\/[^/]+\/status\/(\d+)/)?.[1];
      if (xId && !(await productionPublicBackend().service.inspect([xId])).some(video => video.eligible)) {
        return json({ ok: false, error: "X投稿は掲載許可済みの動画を登録してください。" }, 400);
      }
    }
    const state = await writeManualState(body.revision, body.action, body.entry);
    return json({ ok: true, state });
  } catch (error) {
    const code = error instanceof Error ? error.message : "MANUAL_UPDATE_FAILED";
    const conflict = ["MANUAL_REVISION_CHANGED", "MANUAL_POSITION_OCCUPIED", "MANUAL_URL_EXISTS", "MANUAL_UPDATE_BUSY"].includes(code);
    return json({ ok: false, error: code }, conflict ? 409 : code.startsWith("MANUAL_") ? 400 : 503);
  }
}
