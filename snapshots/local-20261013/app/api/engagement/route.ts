import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "../../../lib/supabase-admin";

export const runtime = "nodejs";

const EVENT_BUCKET_SECONDS = {
  page_view: 86400,
  video_open: 300,
  qualified_view: 1800,
  ranking_change: 60,
  outbound_x: 300
} as const;

type EventType = keyof typeof EVENT_BUCKET_SECONDS;

function safeText(value: unknown, maximum: number) {
  return typeof value === "string" && value.length > 0 && value.length <= maximum
    ? value
    : null;
}

function allowedOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return true;

  try {
    const hostname = new URL(origin).hostname;
    const vercelHostname = process.env.VERCEL_URL?.split(":")[0];
    return (
      hostname === "xcliprank.com" ||
      hostname === "www.xcliprank.com" ||
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === vercelHostname
    );
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  if (!allowedOrigin(request)) {
    return NextResponse.json({ ok: false }, { status: 403 });
  }

  try {
    const body = await request.json();
    const eventType = body?.eventType as EventType;
    if (!(eventType in EVENT_BUCKET_SECONDS)) {
      return NextResponse.json({ ok: false, error: "invalid_event" }, { status: 400 });
    }

    const anonymousId = safeText(body?.anonymousId, 100);
    const sessionId = safeText(body?.sessionId, 100);
    const xPostId = body?.xPostId == null ? null : safeText(body.xPostId, 30);
    const range = body?.range == null ? null : safeText(body.range, 24);
    const source = body?.source == null ? null : safeText(body.source, 40);

    if (!anonymousId || !sessionId || (xPostId && !/^\d{1,30}$/.test(xPostId))) {
      return NextResponse.json({ ok: false, error: "invalid_payload" }, { status: 400 });
    }

    const metadata =
      body?.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
        ? body.metadata
        : {};
    if (JSON.stringify(metadata).length > 1000) {
      return NextResponse.json({ ok: false, error: "metadata_too_large" }, { status: 400 });
    }

    const salt = process.env.ENGAGEMENT_HASH_SALT ?? process.env.CRON_SECRET ?? "xcliprank";
    const anonymousIdHash = createHash("sha256")
      .update(`${salt}:${anonymousId}`)
      .digest("hex");
    const bucketSeconds = EVENT_BUCKET_SECONDS[eventType];
    const bucket = Math.floor(Date.now() / 1000 / bucketSeconds);
    const dedupeKey = createHash("sha256")
      .update(`${anonymousIdHash}:${sessionId}:${eventType}:${xPostId ?? "-"}:${range ?? "-"}:${bucket}`)
      .digest("hex");

    const { error } = await supabaseAdmin()
      .from("engagement_events")
      .upsert(
        {
          event_type: eventType,
          x_post_id: xPostId,
          anonymous_id_hash: anonymousIdHash,
          session_id: sessionId,
          source,
          range,
          metadata,
          dedupe_key: dedupeKey
        },
        { onConflict: "dedupe_key", ignoreDuplicates: true }
      );

    if (error) throw error;

    return NextResponse.json(
      { ok: true },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (error) {
    console.error("engagement event error", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
