import { timingSafeEqual } from "node:crypto";
import { productionPublicBackend } from "../../../../lib/public-video-production";
import { readVapidConfig, sendWebPush } from "../../../../lib/web-push";
import { runDigest } from "../../../../lib/push-service";
import { supabasePushStore } from "../../../../lib/push-store";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;
const headers = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" };
function authorized(request: Request) {
  const secret = process.env.PUSH_SEND_SECRET ?? "", given = request.headers.get("x-push-secret") ?? "";
  if (secret.length < 24 || given.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(secret), Buffer.from(given));
}
/** Called by the daily cron job with the shared secret. Sends at most one plain notification per subscription. */
export async function POST(request: Request) {
  if (!authorized(request)) return Response.json({ ok: false }, { status: 401, headers });
  const vapid = readVapidConfig(); if (!vapid) return Response.json({ ok: false, reason: "vapid" }, { status: 503, headers });
  try {
    const service = productionPublicBackend({ readOnlyRender: true }).service;
    const summary = await runDigest({ store: supabasePushStore(), feed: keys => service.followFeed(keys), send: sendWebPush, vapid });
    return Response.json({ ok: true, ...summary }, { headers });
  } catch { return Response.json({ ok: false }, { status: 503, headers }); }
}
