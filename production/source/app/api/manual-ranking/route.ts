import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { parseManualPlacement, readManualState, writeManualState } from "../../../lib/manual-ranking";
import { productionPublicBackend } from "../../../lib/public-video-production";
import { prepareManualThumbnail } from "../../../lib/manual-thumbnail";
import { storeManualThumbnail } from "../../../lib/manual-thumbnail-store";
import { readManualRequestBody } from "../../../lib/manual-request-body";
import { prepareManualXCandidate } from "../../../lib/manual-x-candidate";
import { publishFreeCandidates } from "../../../lib/free-curated-publish";
import { parseFreePostUrl } from "../../../lib/fxtwitter-curated";
import { unavailableKeys } from "../../../lib/post-status-store";
import { isUnavailablePost } from "../../../lib/post-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" };
const json = (body: object, status = 200) => NextResponse.json(body, { status, headers });
const endpoint = "https://twizou.net/api/manual-ranking";

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
  const response = await fetch(endpoint, {
    method: body === undefined ? "GET" : "POST", redirect: "error", cache: "no-store",
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body, signal: AbortSignal.timeout(75000),
  });
  if (!response.headers.get("content-type")?.includes("application/json")) return json({ ok: false, error: "本番APIが未適用です。" }, 502);
  const payload = await response.json();
  return json(payload, response.status);
}
export async function GET(request: NextRequest) {
  if (!authorized(request)) return json({ ok: false, error: "認証が必要です。" }, 401);
  try {
    if (localRequest(request)) return await forward(request);
    const state = await readManualState();
    return json({ ok: true, state });
  } catch { return json({ ok: false, error: "登録状態を取得できません。" }, 503); }
}
export async function POST(request: NextRequest) {
  if (!authorized(request)) return json({ ok: false, error: "認証が必要です。" }, 401);
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
      if (!body.entry || typeof body.entry !== "object") throw Error("MANUAL_INPUT_INVALID");
      // Client input must never be used to grant publication permission.
      delete body.entry.xApproval;
      let host = "";
      try { host = new URL(body.entry.url).hostname.toLowerCase(); } catch { /* validation below */ }
      const isX = ["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(host);
      if (isX) {
        if (body.thumbnailData != null) return json({ ok: false, error: "X投稿のサムネイルは投稿から取得します。" }, 400);
        const postId = parseFreePostUrl(body.entry.url);
        const { author, candidate: fetched } = await prepareManualXCandidate(body.entry.url, { signal: request.signal });
        const blocked = await unavailableKeys();
        if (fetched.x_post_id !== postId || isUnavailablePost(fetched, blocked) || blocked.has("name:" + author.username.toLowerCase()))
          throw Error("MANUAL_POST_UNAVAILABLE");
        body.entry.url = `https://x.com/${author.username}/status/${postId}`;
        body.entry.title = typeof body.entry.title === "string" && body.entry.title.trim() ? body.entry.title : `${author.name}の動画`;
        body.entry.posterUrl = fetched.preview_image_url || null;
        body.entry.xApproval = { postId, authorId: author.id, videoHash: createHash("sha256").update(fetched.video_url!).digest("hex") };
        parseManualPlacement(body.entry);
        const previous = await readManualState();
        const old = previous.entries.find(entry => entry.id === body.entry.id);
        if (previous.entries.some(entry => entry.id !== body.entry.id && /(?:^|\/)status\/(\d+)/.exec(new URL(entry.url).pathname)?.[1] === postId))
          throw Error("MANUAL_URL_EXISTS");
        const next = await writeManualState(body.revision, "save", body.entry);
        const saved = next.entries.find(entry => entry.xApproval?.postId === postId);
        if (!saved) throw Error("MANUAL_UPDATE_FAILED");
        try {
          await publishFreeCandidates(author, [fetched], { blocked, manualPost: true });
          if (!(await productionPublicBackend().service.inspect([postId])).some(video => video.eligible)) throw Error("MANUAL_POST_NOT_PUBLISHED");
        } catch (error) {
          // Revision checking prevents rollback from overwriting another admin edit.
          try { await writeManualState(next.revision, old ? "save" : "remove", old ?? { id: saved.id }); }
          catch { throw Error("MANUAL_UPDATE_PARTIAL_REVIEW_REQUIRED"); }
          throw error;
        }
        return json({ ok: true, state: next });
      }
      const candidate = parseManualPlacement(body.entry);
      const xId = candidate.url.match(/(?:x\.com|twitter\.com)\/[^/]+\/status\/(\d+)/)?.[1];
      if (body.thumbnailData != null) {
        if (xId) return json({ ok: false, error: "X投稿のサムネイルは投稿から取得します。" }, 400);
        const image = await prepareManualThumbnail(body.thumbnailData);
        body.entry.posterUrl = await storeManualThumbnail(image.bytes, image.sha256);
      }
      if (xId && !(await productionPublicBackend().service.inspect([xId])).some(video => video.eligible)) {
        return json({ ok: false, error: "X投稿は掲載許可済みの動画を登録してください。" }, 400);
      }
    }
    const state = await writeManualState(body.revision, body.action, body.entry);
    return json({ ok: true, state });
  } catch (error) {
    const code = error instanceof Error ? error.message : "MANUAL_UPDATE_FAILED";
    const conflict = ["MANUAL_REVISION_CHANGED", "MANUAL_POSITION_OCCUPIED", "MANUAL_URL_EXISTS", "MANUAL_UPDATE_BUSY"].includes(code);
    const messages: Record<string,string> = {
      MANUAL_POST_UNAVAILABLE: "削除・非公開・掲載停止の投稿は登録できません。",
      MANUAL_POST_NOT_PUBLISHED: "投稿の公開条件を確認できませんでした。非公開や審査対象の可能性があります。",
      MANUAL_UPDATE_PARTIAL_REVIEW_REQUIRED: "登録中に競合が発生しました。再実行せず登録状態を確認してください。",
      MANUAL_IMAGE_INVALID: "画像を読み取れません。JPEG・PNG・WebPの静止画像を選んでください。",
      MANUAL_IMAGE_TOO_LARGE: "画像のサイズが大きすぎます。3MB以下を選んでください。",
      MANUAL_IMAGE_STORAGE_FULL: "画像の保存枠がいっぱいです。管理者へお問い合わせください。",
      MANUAL_INPUT_TOO_LARGE: "入力が大きすぎます。画像は3MB以下にしてください。",
    };
    return json({ ok: false, error: messages[code] ?? code }, conflict ? 409 : code === "MANUAL_INPUT_TOO_LARGE" ? 413 : code.startsWith("MANUAL_") ? 400 : 503);
  }
}
