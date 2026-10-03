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
const MAX_CURATED_AUTHORS = 1000;

function selectCuratedAuthors(authors: CuratedAuthor[]) {
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
    // Recovery must be explicitly requested through the authenticated endpoint.
    // At most 400 requested Post reads ($2 at the published $0.005/read rate).
    const recovery = request.nextUrl.searchParams.get("recovery") === "1";
    const targetAuthor = request.nextUrl.searchParams.get("author");
    const targetAuthors = targetAuthor ? targetAuthor.split(",") : [];
    if ((recovery && targetAuthors.length === 0) || targetAuthors.length > 6 ||
      targetAuthors.some(name => !/^[A-Za-z0-9_]{1,15}$/.test(name))) {
      return NextResponse.json({ ok: false, error: "Invalid author" }, { status: 400 });
    }
    const readBudget = recovery ? { remaining: 400 } : undefined;
    let query = supabaseAdmin().from("authors")
      .select(CURATED_AUTHOR_SELECT)
      .eq("is_curated", true)
      .eq("curated_status", "active")
      .eq("curated_backfill_status", "completed")
      .order("curated_last_attempt_at", { ascending: true, nullsFirst: true })
      .limit(MAX_CURATED_AUTHORS);
    if (targetAuthors.length) query = query.in("username", targetAuthors);
    const { data, error } = await query;
    if (error) throw error;
    const results = [];
    const authors = selectCuratedAuthors((data ?? []) as unknown as CuratedAuthor[]);
    let halted: string | null = null;
    for (const author of authors) {
      if (readBudget && readBudget.remaining < 10) {
        halted = "read_budget";
        break;
      }
      const mode: CuratedCollectionMode = "incremental";
      try {
        const result = await collectCuratedAuthor(author, mode, {
          incrementalPostReadLimit: recovery ? 200 : 50,
          readBudget,
        });
        results.push({ ok: !result.incomplete, ...result });
        console.log("CURATED_AUTHOR_RESULT", JSON.stringify({
          author: result.author,
          status: result.incomplete ? "incomplete" : "completed",
          apiReadPosts: result.apiReadPosts, fetched: result.fetched,
          saved: result.saved, duplicates: result.duplicates,
          resumed: result.resumed,
        }));
      } catch (caught) {
        const message = errorMessage(caught, "収集失敗");
        const httpStatus = Number(message.match(/X API (\d{3})/)?.[1]) || null;
        results.push({ ok: false, author: author.username, mode, error: message });
        console.log("CURATED_AUTHOR_RESULT", JSON.stringify({
          author: author.username, status: "error", xHttpStatus: httpStatus,
          reason: httpStatus ? "x_api_error" : "collection_or_db_error",
        }));
        if (httpStatus === 429 || httpStatus === 402) {
          halted = httpStatus === 429 ? "rate_limit" : "credits";
          break;
        }
      }
    }
    const failed = results.filter((result) => !result.ok).length;
    const incomplete = results.filter((result) => "incomplete" in result && result.incomplete).length;
    const errors = failed - incomplete;
    const ok = failed === 0 && !halted;
    const summary = {
      ok, processed: results.length, failed, incomplete, errors, halted,
      unprocessed: authors.length - results.length,
      recovery, reservedReads: readBudget ? 400 - readBudget.remaining : null,
    };
    console.log("CURATED_BATCH_RESULT", JSON.stringify(summary));
    return NextResponse.json(
      { ...summary, results },
      { status: ok ? 200 : 502 }
    );
  } catch (error) {
    return NextResponse.json({ ok: false, error: errorMessage(error, "一括収集に失敗しました") }, { status: 500 });
  }
}
