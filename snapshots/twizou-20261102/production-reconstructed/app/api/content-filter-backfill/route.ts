import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "../../../lib/supabase-admin";
import {
  classifyContent,
  type ContentCategory,
} from "../../../lib/content-filter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Mode = "dry-run" | "apply";

type PostRow = {
  id: number;
  text: string | null;
  content_category: string | null;
  content_filter_score: number | null;
  content_filter_reason: string | null;
};

type DesiredValues = {
  content_category: ContentCategory;
  content_filter_score: number;
  content_filter_reason: string;
};

type PendingUpdate = DesiredValues & { id: number };

const PAGE_SIZE = 500;
const UPDATE_BATCH_SIZE = 50;
const CATEGORIES: readonly ContentCategory[] = [
  "PASS",
  "AI_GENERATED",
  "SOFT_GRAVURE",
  "PROMO",
  "OUT_OF_SCOPE",
  "SAFETY_REVIEW",
];

function emptyCategoryCounts(): Record<ContentCategory, number> {
  return Object.fromEntries(CATEGORIES.map((category) => [category, 0])) as
    Record<ContentCategory, number>;
}

function responseHeaders() {
  return { "Cache-Control": "no-store" };
}

function desiredValues(post: PostRow): DesiredValues {
  const classified = classifyContent(post.text ?? "");

  // 一度保存された安全レビューを、後続の通常カテゴリで解除しない。
  if (
    post.content_category === "SAFETY_REVIEW" &&
    classified.category !== "SAFETY_REVIEW"
  ) {
    return {
      content_category: "SAFETY_REVIEW",
      content_filter_score: post.content_filter_score ?? 1,
      content_filter_reason:
        post.content_filter_reason ??
        "保存済みの安全レビューを維持。公開前の確認が必要。",
    };
  }

  return {
    content_category: classified.category,
    content_filter_score: classified.score,
    content_filter_reason: classified.reason,
  };
}

function needsUpdate(post: PostRow, desired: DesiredValues) {
  return (
    post.content_category !== desired.content_category ||
    post.content_filter_score !== desired.content_filter_score ||
    post.content_filter_reason !== desired.content_filter_reason
  );
}

export async function POST(request: NextRequest) {
  const headers = responseHeaders();
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401, headers },
    );
  }

  let body: unknown = {};
  try {
    const raw = await request.text();
    body = raw ? JSON.parse(raw) : {};
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON body" },
      { status: 400, headers },
    );
  }

  const input = body && typeof body === "object"
    ? body as { mode?: unknown; confirmation?: unknown }
    : {};
  const mode = (input.mode ?? "dry-run") as Mode;
  if (mode !== "dry-run" && mode !== "apply") {
    return NextResponse.json(
      { success: false, error: "mode must be dry-run or apply" },
      { status: 400, headers },
    );
  }
  if (mode === "apply" && input.confirmation !== "APPLY_CONTENT_FILTER") {
    return NextResponse.json(
      { success: false, error: "Invalid apply confirmation" },
      { status: 400, headers },
    );
  }

  const categoryCounts = emptyCategoryCounts();
  const pending: PendingUpdate[] = [];
  let totalCount = 0;
  let unchangedCount = 0;

  let supabase: ReturnType<typeof supabaseAdmin>;
  try {
    supabase = supabaseAdmin();
  } catch {
    return NextResponse.json({
      success: false,
      mode,
      total_count: 0,
      category_counts: categoryCounts,
      change_required_count: 0,
      unchanged_count: 0,
      updated_count: 0,
      failed_stage: "initialize",
      retryable: true,
      error: "Backfill initialization failed",
    }, { status: 500, headers });
  }

  for (;;) {
    const { data, error } = await supabase
      .from("posts")
      .select(
        "id,text,content_category,content_filter_score,content_filter_reason",
      )
      .order("id", { ascending: true })
      .range(totalCount, totalCount + PAGE_SIZE - 1);

    if (error) {
      return NextResponse.json({
        success: false,
        mode,
        total_count: totalCount,
        category_counts: categoryCounts,
        change_required_count: pending.length,
        unchanged_count: unchangedCount,
        updated_count: 0,
        failed_stage: "read_posts",
        failed_page_start: totalCount,
        retryable: true,
        error: "Backfill read failed",
      }, { status: 500, headers });
    }

    const posts = (data ?? []) as PostRow[];
    if (posts.length === 0) break;
    for (const post of posts) {
      const desired = desiredValues(post);
      categoryCounts[desired.content_category]++;
      if (needsUpdate(post, desired)) {
        pending.push({ id: post.id, ...desired });
      } else {
        unchangedCount++;
      }
    }
    totalCount += posts.length;
  }

  if (mode === "dry-run") {
    return NextResponse.json({
      success: true,
      mode,
      total_count: totalCount,
      category_counts: categoryCounts,
      change_required_count: pending.length,
      unchanged_count: unchangedCount,
      updated_count: 0,
    }, { headers });
  }

  let updatedCount = 0;
  const groups = new Map<string, { values: DesiredValues; ids: number[] }>();
  for (const update of pending) {
    const { id, ...values } = update;
    const key = JSON.stringify([
      values.content_category,
      values.content_filter_score,
      values.content_filter_reason,
    ]);
    const group = groups.get(key);
    if (group) {
      group.ids.push(id);
    } else {
      groups.set(key, { values, ids: [id] });
    }
  }

  let batchIndex = 0;
  for (const group of groups.values()) {
    for (let start = 0; start < group.ids.length; start += UPDATE_BATCH_SIZE) {
      const ids = group.ids.slice(start, start + UPDATE_BATCH_SIZE);
      const { data, error } = await supabase
        .from("posts")
        .update(group.values)
        .in("id", ids)
        .select("id");
      if (error || !data || data.length !== ids.length) {
        return NextResponse.json({
          success: false,
          mode,
          total_count: totalCount,
          category_counts: categoryCounts,
          change_required_count: pending.length,
          unchanged_count: unchangedCount,
          updated_count: updatedCount,
          failed_count: ids.length,
          failed_stage: "update_batch",
          failed_batch_index: batchIndex,
          retryable: true,
          error: "Backfill update partially failed",
        }, { status: 500, headers });
      }
      updatedCount += data.length;
      batchIndex++;
    }
  }

  return NextResponse.json({
    success: true,
    mode,
    total_count: totalCount,
    category_counts: categoryCounts,
    change_required_count: pending.length,
    unchanged_count: unchangedCount,
    updated_count: updatedCount,
  }, { headers });
}
