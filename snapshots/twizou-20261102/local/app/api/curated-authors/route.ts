import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "../../../lib/cron-auth";
import { CURATED_AUTHOR_SELECT } from "../../../lib/curated-collector";
import { errorMessage } from "../../../lib/error-message";
import { supabaseAdmin } from "../../../lib/supabase-admin";
import { lookupXUserByUsername } from "../../../lib/x";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeUsername(value: unknown) {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/(?:x\.com|twitter\.com)\/([A-Za-z0-9_]{1,15})/i);
  const normalized = (match?.[1] ?? value.trim().replace(/^@/, "")).trim();
  return /^[A-Za-z0-9_]{1,15}$/.test(normalized) ? normalized : null;
}

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { data, error } = await supabaseAdmin().from("authors")
      .select(CURATED_AUTHOR_SELECT)
      .eq("is_curated", true)
      .order("curated_added_at", { ascending: false });
    if (error) throw error;
    return NextResponse.json({ ok: true, authors: data ?? [] });
  } catch (error) {
    return NextResponse.json({ ok: false, error: errorMessage(error, "取得に失敗しました") }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json();
    const action = String(body.action ?? "");
    const supabase = supabaseAdmin();

    if (action === "add") {
      const username = normalizeUsername(body.username);
      const expectedTier = body.expectedTier === "A" ? "A" : "S";
      if (!username) return NextResponse.json({ ok: false, error: "Xユーザー名が正しくありません" }, { status: 400 });
      const { data: knownAuthors, error: knownError } = await supabase.from("authors")
        .select("x_author_id,username,name")
        .ilike("username", username)
        .limit(1);
      if (knownError) throw knownError;
      const known = knownAuthors?.[0];
      const user = known?.x_author_id && known.username
        ? { id: known.x_author_id, username: known.username, name: known.name ?? known.username }
        : await lookupXUserByUsername(username);
      const now = new Date().toISOString();
      const { data, error } = await supabase.from("authors").upsert({
        x_author_id: user.id,
        username: user.username,
        name: user.name,
        is_curated: true,
        curated_status: "active",
        curated_expected_tier: expectedTier,
        curated_added_at: now,
        curated_backfill_status: "pending",
        curated_last_error: null,
        last_seen_at: now,
      }, { onConflict: "x_author_id" }).select(CURATED_AUTHOR_SELECT).single();
      if (error) throw error;
      return NextResponse.json({ ok: true, author: data, initialCollectionRequired: true });
    }

    if (["pause", "resume"].includes(action)) {
      const xAuthorId = typeof body.xAuthorId === "string" ? body.xAuthorId : "";
      if (!xAuthorId) return NextResponse.json({ ok: false, error: "投稿者IDが必要です" }, { status: 400 });
      const { data, error } = await supabase.from("authors").update({
        curated_status: action === "pause" ? "paused" : "active",
        ...(action === "resume" ? {
          curated_unavailable_failure_count: 0,
          curated_unavailable_since: null,
          curated_last_error: null
        } : {}),
      }).eq("x_author_id", xAuthorId).eq("is_curated", true).select(CURATED_AUTHOR_SELECT).single();
      if (error) throw error;
      return NextResponse.json({ ok: true, author: data });
    }

    return NextResponse.json({ ok: false, error: "未対応の操作です" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: errorMessage(error, "処理に失敗しました") }, { status: 500 });
  }
}
