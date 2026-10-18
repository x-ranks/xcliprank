import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "../../../lib/cron-auth";
import { errorMessage } from "../../../lib/error-message";
import { supabaseAdmin } from "../../../lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 1000;
const MAX_ROWS = 100000;
const EVENT_TYPES = [
  "page_view",
  "video_open",
  "qualified_view",
  "ranking_change",
  "outbound_x",
] as const;
const RANGES = ["trending", "daily", "weekly", "reels"] as const;

type EngagementRow = {
  occurred_at: string;
  event_type: string;
  anonymous_id_hash: string;
  session_id: string;
  source: string | null;
  range: string | null;
  metadata: Record<string, unknown> | null;
};

type DailyBucket = {
  users: Set<string>;
  sessions: Set<string>;
  xSessions: Set<string>;
  videoOpen: number;
  qualifiedView: number;
  rankingChange: number;
  outboundX: number;
};

function japaneseDate(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function textMetadata(metadata: Record<string, unknown> | null, key: string) {
  const value = metadata?.[key];
  return typeof value === "string" ? value.toLowerCase() : "";
}

function acquisitionOf(row: EngagementRow) {
  const utmSource = textMetadata(row.metadata, "utmSource");
  const referrerHost = textMetadata(row.metadata, "referrerHost");

  if (
    utmSource === "x" ||
    utmSource === "twitter" ||
    referrerHost === "x.com" ||
    referrerHost.endsWith(".x.com") ||
    referrerHost === "twitter.com" ||
    referrerHost.endsWith(".twitter.com") ||
    referrerHost === "t.co"
  ) {
    return "x";
  }
  if (utmSource) return `campaign:${utmSource}`;
  if (referrerHost) return `referral:${referrerHost}`;
  return "direct";
}

function emptyDailyBucket(): DailyBucket {
  return {
    users: new Set(),
    sessions: new Set(),
    xSessions: new Set(),
    videoOpen: 0,
    qualifiedView: 0,
    rankingChange: 0,
    outboundX: 0,
  };
}

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401, headers: { "cache-control": "no-store" } }
    );
  }

  try {
    const requestedDays = Number(request.nextUrl.searchParams.get("days") ?? 7);
    const days = requestedDays === 30 ? 30 : 7;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const rows: EngagementRow[] = [];

    for (let from = 0; from < MAX_ROWS; from += PAGE_SIZE) {
      const { data, error } = await supabaseAdmin()
        .from("engagement_events")
        .select(
          "occurred_at,event_type,anonymous_id_hash,session_id,source,range,metadata"
        )
        .gte("occurred_at", since)
        .order("occurred_at", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);

      if (error) throw error;
      const batch = (data ?? []) as EngagementRow[];
      rows.push(...batch);
      if (batch.length < PAGE_SIZE) break;
    }

    const truncated = rows.length >= MAX_ROWS;
    const users = new Set<string>();
    const sessions = new Set<string>();
    const xSessions = new Set<string>();
    const sessionAcquisition = new Map<string, string>();
    const xContentSessionSets = new Map<string, Set<string>>();
    const daily = new Map<string, DailyBucket>();
    const eventCounts = Object.fromEntries(
      EVENT_TYPES.map((eventType) => [eventType, 0])
    ) as Record<string, number>;
    const rangeOpens = Object.fromEntries(
      RANGES.map((range) => [range, 0])
    ) as Record<string, number>;

    for (const row of rows) {
      users.add(row.anonymous_id_hash);
      sessions.add(row.session_id);
      eventCounts[row.event_type] = (eventCounts[row.event_type] ?? 0) + 1;

      const acquisition = acquisitionOf(row);
      if (!sessionAcquisition.has(row.session_id)) {
        sessionAcquisition.set(row.session_id, acquisition);
      } else if (
        sessionAcquisition.get(row.session_id) === "direct" &&
        acquisition !== "direct"
      ) {
        sessionAcquisition.set(row.session_id, acquisition);
      }

      if (acquisition === "x") xSessions.add(row.session_id);
      if (acquisition === "x") {
        const utmContent = textMetadata(row.metadata, "utmContent");
        if (utmContent) {
          const contentSessions =
            xContentSessionSets.get(utmContent) ?? new Set<string>();
          contentSessions.add(row.session_id);
          xContentSessionSets.set(utmContent, contentSessions);
        }
      }

      const day = japaneseDate(row.occurred_at);
      const bucket = daily.get(day) ?? emptyDailyBucket();
      bucket.users.add(row.anonymous_id_hash);
      bucket.sessions.add(row.session_id);
      if (acquisition === "x") bucket.xSessions.add(row.session_id);

      if (row.event_type === "video_open") {
        bucket.videoOpen += 1;
        const range = row.range || "unknown";
        rangeOpens[range] = (rangeOpens[range] ?? 0) + 1;
      } else if (row.event_type === "qualified_view") {
        bucket.qualifiedView += 1;
      } else if (row.event_type === "ranking_change") {
        bucket.rankingChange += 1;
      } else if (row.event_type === "outbound_x") {
        bucket.outboundX += 1;
      }
      daily.set(day, bucket);
    }

    const acquisitionSessions: Record<string, number> = {};
    for (const acquisition of sessionAcquisition.values()) {
      acquisitionSessions[acquisition] =
        (acquisitionSessions[acquisition] ?? 0) + 1;
    }

    const videoOpen = eventCounts.video_open ?? 0;
    const qualifiedView = eventCounts.qualified_view ?? 0;
    const sessionCount = sessions.size;

    return NextResponse.json(
      {
        ok: true,
        days,
        since,
        timezone: "Asia/Tokyo",
        truncated,
        totals: {
          events: rows.length,
          pageView: eventCounts.page_view ?? 0,
          users: users.size,
          sessions: sessionCount,
          xSessions: xSessions.size,
          videoOpen,
          qualifiedView,
          rankingChange: eventCounts.ranking_change ?? 0,
          outboundX: eventCounts.outbound_x ?? 0,
          opensPerSession:
            sessionCount > 0 ? Number((videoOpen / sessionCount).toFixed(2)) : 0,
          qualificationRate:
            videoOpen > 0
              ? Number(((qualifiedView / videoOpen) * 100).toFixed(1))
              : 0,
        },
        daily: Array.from(daily.entries()).map(([date, bucket]) => ({
          date,
          users: bucket.users.size,
          sessions: bucket.sessions.size,
          xSessions: bucket.xSessions.size,
          videoOpen: bucket.videoOpen,
          qualifiedView: bucket.qualifiedView,
          rankingChange: bucket.rankingChange,
          outboundX: bucket.outboundX,
        })),
        rangeOpens,
        acquisitionSessions,
        xContentSessions: Object.fromEntries(
          Array.from(xContentSessionSets.entries()).map(([key, value]) => [
            key,
            value.size,
          ])
        ),
      },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: errorMessage(error, "計測データの取得に失敗しました"),
      },
      { status: 500, headers: { "cache-control": "no-store" } }
    );
  }
}
