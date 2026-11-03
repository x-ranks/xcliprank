import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "../../../lib/cron-auth";
import { supabaseAdmin } from "../../../lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RANGES = new Set(["trending", "daily", "weekly"]);
const REASONS = new Set(["minor", "voyeurism", "nonconsensual", "site_unsuitable", "other"]);

function clean(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const requestedRange = clean(request.nextUrl.searchParams.get("range"), 20);
    const range = RANGES.has(requestedRange) ? requestedRange : "daily";
    const rankingUrl = new URL("/api/rankings", request.nextUrl.origin);
    rankingUrl.searchParams.set("range", range);
    const rankingResponse = await fetch(rankingUrl, { cache: "no-store" });
    const rankingPayload = await rankingResponse.json();
    if (!rankingResponse.ok) throw new Error("ランキングを取得できませんでした。");

    const { data: removed, error } = await supabaseAdmin()
      .from("posts")
      .select("x_post_id,author_username,text,x_url,preview_image_url,adult_tier,moderation_reason,moderation_source,moderated_at")
      .eq("moderation_blocked", true)
      .order("moderated_at", { ascending: false })
      .limit(50);
    if (error) throw error;

    return NextResponse.json({
      success: true,
      range,
      posts: Array.isArray(rankingPayload.data) ? rankingPayload.data : [],
      removed: removed ?? [],
    });
  } catch (error) {
    console.error("Ranking admin GET error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "取得に失敗しました。" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const xPostId = clean(body.xPostId, 30);
    const action = clean(body.action, 20);
    if (!/^\d{5,30}$/.test(xPostId)) {
      return NextResponse.json({ success: false, error: "投稿IDが正しくありません。" }, { status: 400 });
    }

    if (action === "remove") {
      const reason = clean(body.reason, 30);
      if (!REASONS.has(reason)) {
        return NextResponse.json({ success: false, error: "削除理由を選択してください。" }, { status: 400 });
      }
      const now = new Date().toISOString();
      const { data, error } = await supabaseAdmin()
        .from("posts")
        .update({
          is_visible: false,
          review_required: true,
          moderation_blocked: true,
          moderation_reason: reason,
          moderation_source: "ranking_admin",
          moderated_at: now,
        })
        .eq("x_post_id", xPostId)
        .select("x_post_id,moderation_reason,moderated_at")
        .maybeSingle();
      if (error) throw error;
      if (!data) return NextResponse.json({ success: false, error: "投稿が見つかりません。" }, { status: 404 });
      return NextResponse.json({ success: true, post: data });
    }

    if (action === "restore") {
      const { data, error } = await supabaseAdmin()
        .from("posts")
        .update({
          is_visible: true,
          review_required: false,
          moderation_blocked: false,
          moderation_reason: null,
          moderation_source: null,
          moderated_at: null,
        })
        .eq("x_post_id", xPostId)
        .eq("moderation_blocked", true)
        .select("x_post_id")
        .maybeSingle();
      if (error) throw error;
      if (!data) return NextResponse.json({ success: false, error: "復元対象が見つかりません。" }, { status: 404 });
      return NextResponse.json({ success: true, post: data });
    }

    return NextResponse.json({ success: false, error: "操作が正しくありません。" }, { status: 400 });
  } catch (error) {
    console.error("Ranking admin PATCH error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "更新に失敗しました。" },
      { status: 500 }
    );
  }
}
