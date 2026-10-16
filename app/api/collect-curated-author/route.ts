import { NextRequest, NextResponse } from "next/server";
import { collectCuratedAuthor, CURATED_AUTHOR_SELECT, type CuratedAuthor, type CuratedCollectionMode } from "../../../lib/curated-collector";
import { isCronAuthorized } from "../../../lib/cron-auth";
import { errorMessage } from "../../../lib/error-message";
import { supabaseAdmin } from "../../../lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json();
    const xAuthorId = typeof body.xAuthorId === "string" ? body.xAuthorId : "";
    if (!xAuthorId) return NextResponse.json({ ok: false, error: "投稿者IDが必要です" }, { status: 400 });
    const { data: rawAuthor, error } = await supabaseAdmin().from("authors")
      .select(CURATED_AUTHOR_SELECT)
      .eq("x_author_id", xAuthorId)
      .eq("is_curated", true)
      .single();
    if (error || !rawAuthor) throw error ?? new Error("投稿者が見つかりません");
    const author = rawAuthor as unknown as CuratedAuthor & { curated_status: string | null };
    if (author.curated_status !== "active") return NextResponse.json({ ok: false, error: "この投稿者は一時停止中です" }, { status: 409 });
    const mode: CuratedCollectionMode = author.curated_backfill_status === "completed" ? "incremental" : "initial";
    const result = await collectCuratedAuthor(author, mode);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: errorMessage(error, "収集に失敗しました") }, { status: 500 });
  }
}
