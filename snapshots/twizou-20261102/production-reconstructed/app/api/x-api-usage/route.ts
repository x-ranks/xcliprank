import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "../../../lib/cron-auth";
import { errorMessage } from "../../../lib/error-message";
import { supabaseAdmin } from "../../../lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SOURCES = ["discovery", "priority", "curated_initial", "curated_incremental", "author_lookup", "x_publish"] as const;

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  try {
    const days = Math.max(1, Math.min(90, Number(request.nextUrl.searchParams.get("days") ?? 30)));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabaseAdmin().from("x_api_usage_logs")
      .select("created_at,source,endpoint,http_status,post_count,user_count,duration_ms")
      .gte("created_at", since).order("created_at", { ascending: true }).limit(10000);
    if (error) throw error;
    const rows = data ?? [];
    const bySource = Object.fromEntries(SOURCES.map((source) => [source, { requests: 0, posts: 0, users: 0, errors: 0 }])) as Record<string, { requests: number; posts: number; users: number; errors: number }>;
    const byDay: Record<string, { requests: number; posts: number; users: number }> = {};
    for (const row of rows) {
      const source = String(row.source);
      const target = bySource[source] ?? (bySource[source] = { requests: 0, posts: 0, users: 0, errors: 0 });
      target.requests += 1;
      target.posts += Number(row.post_count ?? 0);
      target.users += Number(row.user_count ?? 0);
      if (Number(row.http_status ?? 0) >= 400 || Number(row.http_status ?? 0) === 0) target.errors += 1;
      const day = String(row.created_at).slice(0, 10);
      byDay[day] ??= { requests: 0, posts: 0, users: 0 };
      byDay[day].requests += 1;
      byDay[day].posts += Number(row.post_count ?? 0);
      byDay[day].users += Number(row.user_count ?? 0);
    }
    return NextResponse.json({ ok: true, days, since, total: { requests: rows.length, posts: rows.reduce((sum, row) => sum + Number(row.post_count ?? 0), 0), users: rows.reduce((sum, row) => sum + Number(row.user_count ?? 0), 0) }, bySource, byDay });
  } catch (error) {
    return NextResponse.json({ ok: false, error: errorMessage(error, "利用量の取得に失敗しました") }, { status: 500 });
  }
}
