import { NextRequest, NextResponse } from "next/server";
import { collectCuratedAuthor, CURATED_AUTHOR_SELECT, type CuratedAuthor, type CuratedCollectionMode } from "../../../lib/curated-collector";
import { isCronAuthorized } from "../../../lib/cron-auth";
import { errorMessage } from "../../../lib/error-message";
import { supabaseAdmin } from "../../../lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Cronは1日1回。X APIの利用量を抑えるため、1日あたり最大24投稿者だけ収集する。
// 最終収集日時が古い投稿者から選ぶため、未処理の投稿者は翌日以降に順番に回る。
const MAX_AUTHORS_PER_RUN = 24;

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { data, error } = await supabaseAdmin().from("authors")
      .select(CURATED_AUTHOR_SELECT)
      .eq("is_curated", true)
      .eq("curated_status", "active")
      .order("curated_backfill_status", { ascending: true, nullsFirst: true })
      .order("curated_last_collected_at", { ascending: true, nullsFirst: true })
      .limit(MAX_AUTHORS_PER_RUN);
    if (error) throw error;
    const results = [];
    for (const rawAuthor of data ?? []) {
      const author = rawAuthor as unknown as CuratedAuthor;
      const mode: CuratedCollectionMode = author.curated_backfill_status === "completed" ? "incremental" : "initial";
      try {
        results.push({ ok: true, ...(await collectCuratedAuthor(author, mode)) });
      } catch (caught) {
        results.push({ ok: false, author: author.username, mode, error: errorMessage(caught, "収集失敗") });
      }
    }
    return NextResponse.json({ ok: true, processed: results.length, results });
  } catch (error) {
    return NextResponse.json({ ok: false, error: errorMessage(error, "一括収集に失敗しました") }, { status: 500 });
  }
}
