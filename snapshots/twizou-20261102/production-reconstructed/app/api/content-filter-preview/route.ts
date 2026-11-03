import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "../../../lib/supabase-admin";
import {
  classifyContent,
  type ContentCategory,
} from "../../../lib/content-filter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReviewedPost = {
  x_post_id: string;
  text: string | null;
  manual_tier: string;
  manual_category: string | null;
};

const CATEGORY_MAPPING = new Map<string, ContentCategory>([
  ["ai_generated", "AI_GENERATED"],
  ["soft_gravure", "SOFT_GRAVURE"],
  ["promo_sample", "PROMO"],
  ["promo", "PROMO"],
  ["out_of_scope", "OUT_OF_SCOPE"],
  ["safety_review", "SAFETY_REVIEW"],
  ["pass", "PASS"],
]);

function metric(count: number, total: number) {
  return { count, total, rate: total === 0 ? null : count / total };
}

// GETのみ。分類器の結果を返すだけで、DBへの書き込みは行わない。
export async function GET(request: NextRequest) {
  const headers = { "Cache-Control": "no-store" };
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401, headers },
    );
  }

  try {
    const supabase = supabaseAdmin();
    const pageSize = 500;
    const keepTiers = new Set(["S", "A", "B", "C", "D"]);
    let total = 0;
    let manualX = 0;
    let excludedX = 0;
    let manualKeep = 0;
    let excludedKeep = 0;
    let unrecognizedTier = 0;
    const cross = new Map<string | null, Map<ContentCategory, number>>();
    const mismatches: Array<ReviewedPost & {
      category: ContentCategory;
      score: number;
      reason: string;
      mismatch_types: string[];
    }> = [];

    // 実際の取得件数で進め、サーバー側の上限が500未満でも取りこぼさない。
    // 複数リクエストのため、集計中は手動評価を変更しないこと。
    for (;;) {
      const { data, error } = await supabase
        .from("posts")
        .select("x_post_id,text,manual_tier,manual_category")
        .not("manual_tier", "is", null)
        .order("id", { ascending: true })
        .range(total, total + pageSize - 1);

      if (error) throw error;
      const posts = (data ?? []) as ReviewedPost[];
      if (posts.length === 0) break;

      for (const post of posts) {
        const result = classifyContent(post.text ?? "");
        const mismatchTypes: string[] = [];
        if (post.manual_tier === "X") {
          manualX++;
          if (result.excluded) excludedX++;
          else mismatchTypes.push("MANUAL_X_PASSED");
        } else if (keepTiers.has(post.manual_tier)) {
          manualKeep++;
          if (result.excluded) {
            excludedKeep++;
            mismatchTypes.push("MANUAL_S_TO_D_EXCLUDED");
          }
        } else {
          unrecognizedTier++;
        }

        let cells = cross.get(post.manual_category);
        if (!cells) {
          cells = new Map();
          cross.set(post.manual_category, cells);
        }
        cells.set(result.category, (cells.get(result.category) ?? 0) + 1);

        // weak_content / repost_duplicate は本文分類の対象外。対応を捏造しない。
        const expected = CATEGORY_MAPPING.get(
          post.manual_category?.trim().toLowerCase() ?? "",
        );
        if (expected && result.category !== expected) {
          mismatchTypes.push("CATEGORY_MISMATCH");
        }
        if (mismatchTypes.length > 0) {
          mismatches.push({
            ...post,
            category: result.category,
            score: result.score,
            reason: result.reason,
            mismatch_types: mismatchTypes,
          });
        }
      }
      total += posts.length;
    }

    return NextResponse.json({
      success: true,
      total_reviewed: total,
      unrecognized_manual_tier_count: unrecognizedTier,
      manual_x_excluded: metric(excludedX, manualX),
      manual_s_to_d_excluded: metric(excludedKeep, manualKeep),
      cross_tabulation: Array.from(cross, ([manual_category, cells]) => ({
        manual_category,
        automatic_categories: Object.fromEntries(cells),
      })),
      mismatches,
      notes: [
        "rateは0〜1。分母は各手動評価群の件数で、0件の場合はnull。",
        "手動S〜Dの除外は誤除外候補。宣伝・サンプル除外方針では正しい場合もある。",
        "手動Xには本文だけで判断できない理由も含まれる。",
        "安全判定を含むclassifyContentの結果を上書きしない。",
        "カテゴリ未記録・未対応はカテゴリ不一致判定の対象外。クロス集計には含める。",
        "ページ分割取得のため、集計中の手動評価変更は避ける。",
      ],
    }, { headers });
  } catch {
    return NextResponse.json(
      { success: false, error: "Failed to generate content filter preview" },
      { status: 500, headers },
    );
  }
}
