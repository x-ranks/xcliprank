import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function configured(name: string) {
  return Boolean(process.env[name]?.trim());
}

function supabaseHost() {
  try {
    return new URL(
      process.env.SUPABASE_URL ??
        process.env.NEXT_PUBLIC_SUPABASE_URL ??
        ""
    ).hostname;
  } catch {
    return null;
  }
}

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse(null, { status: 404 });
  }

  const configuration = {
    supabaseUrl:
      configured("SUPABASE_URL") || configured("NEXT_PUBLIC_SUPABASE_URL"),
    supabaseServiceKey:
      configured("SUPABASE_SECRET_KEY") ||
      configured("SUPABASE_SERVICE_ROLE_KEY"),
    cronSecret: configured("CRON_SECRET"),
    xPublishing:
      configured("X_API_KEY") &&
      configured("X_API_KEY_SECRET") &&
      configured("X_ACCESS_TOKEN") &&
      configured("X_ACCESS_TOKEN_SECRET"),
  };

  if (!configuration.supabaseUrl || !configuration.supabaseServiceKey) {
    return NextResponse.json({
      ok: true,
      databaseConnected: false,
      configuration,
      projectHost: supabaseHost(),
      error:
        ".env.local に本番SupabaseのURLとSecret Key（またはService Role Key）が必要です。",
    });
  }

  try {
    const supabase = supabaseAdmin();
    const [postsResult, manualResult, visualResult] = await Promise.all([
      supabase.from("posts").select("id", { count: "exact", head: true }),
      supabase
        .from("posts")
        .select("manual_reviewed_at")
        .not("manual_reviewed_at", "is", null)
        .order("manual_reviewed_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("posts")
        .select("id", { count: "exact", head: true })
        .not("visual_preference_score", "is", null),
    ]);

    if (postsResult.error) throw postsResult.error;
    if (manualResult.error) throw manualResult.error;
    if (visualResult.error) throw visualResult.error;

    let productionComparison: {
      checked: boolean;
      matched: number;
      sampled: number;
      sameDatabaseLikely: boolean;
      error?: string;
    } = { checked: false, matched: 0, sampled: 0, sameDatabaseLikely: false };

    try {
      const response = await fetch(
        "https://xcliprank.com/api/rankings?range=daily",
        { cache: "no-store" }
      );
      const payload = await response.json();
      const ids = (Array.isArray(payload?.data) ? payload.data : [])
        .map((post: { x_post_id?: unknown }) => String(post.x_post_id ?? ""))
        .filter((id: string) => /^\d+$/.test(id))
        .slice(0, 5);

      if (response.ok && ids.length > 0) {
        const { data, error } = await supabase
          .from("posts")
          .select("x_post_id")
          .in("x_post_id", ids);
        if (error) throw error;
        const matched = data?.length ?? 0;
        productionComparison = {
          checked: true,
          matched,
          sampled: ids.length,
          sameDatabaseLikely: matched === ids.length,
        };
      }
    } catch (error) {
      productionComparison = {
        checked: false,
        matched: 0,
        sampled: 0,
        sameDatabaseLikely: false,
        error: error instanceof Error ? error.message : "本番比較に失敗しました。",
      };
    }

    return NextResponse.json({
      ok: true,
      databaseConnected: true,
      configuration,
      projectHost: supabaseHost(),
      postCount: postsResult.count ?? 0,
      latestManualReviewAt: manualResult.data?.manual_reviewed_at ?? null,
      visualScoreCount: visualResult.count ?? 0,
      productionComparison,
    });
  } catch (error) {
    return NextResponse.json({
      ok: true,
      databaseConnected: false,
      configuration,
      projectHost: supabaseHost(),
      error: error instanceof Error ? error.message : "Supabase接続に失敗しました。",
    });
  }
}
