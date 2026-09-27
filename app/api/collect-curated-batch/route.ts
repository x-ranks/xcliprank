import { NextRequest, NextResponse } from "next/server";
import { collectCuratedAuthor, CURATED_AUTHOR_SELECT, type CuratedAuthor, type CuratedCollectionMode } from "../../../lib/curated-collector";
import { isCronAuthorized } from "../../../lib/cron-auth";
import { errorMessage } from "../../../lib/error-message";
import { supabaseAdmin } from "../../../lib/supabase-admin";
import { validRecentSearchSinceId } from "../../../lib/x";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Cronは1日1回。初回収集が完了した投稿者の新着動画だけを収集する。
// Prioritize authors with a recent video while reserving half the slots for
// dormant authors. The remaining slots fill from the oldest completed checks.
const MAX_AUTHORS_PER_RUN = 24;
const RESERVED_PER_GROUP = MAX_AUTHORS_PER_RUN / 2;
const MAX_CURATED_AUTHORS = 50;

export function selectCuratedAuthors(authors: CuratedAuthor[]) {
  const recent: CuratedAuthor[] = [];
  const dormant: CuratedAuthor[] = [];
  for (const author of authors) {
    (validRecentSearchSinceId(author.curated_last_post_id) ? recent : dormant).push(author);
  }
  const selected = [...recent.slice(0, RESERVED_PER_GROUP), ...dormant.slice(0, RESERVED_PER_GROUP)];
  const selectedIds = new Set(selected.map((author) => author.x_author_id));
  for (const author of authors) {
    if (selected.length >= MAX_AUTHORS_PER_RUN) break;
    if (!selectedIds.has(author.x_author_id)) {
      selected.push(author);
      selectedIds.add(author.x_author_id);
    }
  }
  return selected;
}

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { data, error } = await supabaseAdmin().from("authors")
      .select(CURATED_AUTHOR_SELECT)
      .eq("is_curated", true)
      .eq("curated_status", "active")
      .eq("curated_backfill_status", "completed")
      .order("curated_last_collected_at", { ascending: true, nullsFirst: true })
      .limit(MAX_CURATED_AUTHORS);
    if (error) throw error;
    const results = [];
    const authors = selectCuratedAuthors((data ?? []) as unknown as CuratedAuthor[]);
    for (const author of authors) {
      const mode: CuratedCollectionMode = "incremental";
      try {
        const result = await collectCuratedAuthor(author, mode);
        results.push({ ok: !result.incomplete, ...result });
      } catch (caught) {
        results.push({ ok: false, author: author.username, mode, error: errorMessage(caught, "収集失敗") });
      }
    }
    const failed = results.filter((result) => !result.ok).length;
    return NextResponse.json(
      { ok: failed === 0, processed: results.length, failed, results },
      { status: failed > 0 ? 502 : 200 }
    );
  } catch (error) {
    return NextResponse.json({ ok: false, error: errorMessage(error, "一括収集に失敗しました") }, { status: 500 });
  }
}
