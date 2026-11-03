import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "../../../lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL_PATH = path.join(process.cwd(), "data", "visual-preference-model.json");
const MAX_SCORES = 200;

type ScoreInput = { xPostId: string; score: number };

export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse(null, { status: 404 });
  }

  try {
    const body = await request.json();
    const model = JSON.parse(await readFile(MODEL_PATH, "utf8"));
    if (body.modelTrainedAt !== model.trainedAt) {
      return NextResponse.json({ success: false, error: "学習モデルが更新されています。もう一度解析してください。" }, { status: 409 });
    }
    if (!Array.isArray(body.scores) || body.scores.length === 0 || body.scores.length > MAX_SCORES) {
      return NextResponse.json({ success: false, error: "保存する視覚スコアの件数が正しくありません。" }, { status: 400 });
    }

    const unique = new Map<string, number>();
    for (const item of body.scores as ScoreInput[]) {
      const xPostId = typeof item?.xPostId === "string" ? item.xPostId.trim() : "";
      const score = Number(item?.score);
      if (!/^\d+$/.test(xPostId) || !Number.isFinite(score) || Math.abs(score) > 1000) {
        return NextResponse.json({ success: false, error: "視覚スコアの形式が正しくありません。" }, { status: 400 });
      }
      unique.set(xPostId, score);
    }

    const entries = [...unique.entries()];
    let updatedCount = 0;
    for (let index = 0; index < entries.length; index += 10) {
      const batch = entries.slice(index, index + 10);
      const results = await Promise.all(batch.map(async ([xPostId, score]) => {
        const { data, error } = await supabaseAdmin()
          .from("posts")
          .update({ visual_preference_score: score })
          .eq("x_post_id", xPostId)
          .select("id");
        if (error) throw error;
        return data?.length ?? 0;
      }));
      updatedCount += results.reduce((sum, count) => sum + count, 0);
    }

    return NextResponse.json({ success: true, requestedCount: entries.length, updatedCount });
  } catch (error) {
    console.error("Visual preference score save error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "視覚スコアの保存に失敗しました。" },
      { status: 500 }
    );
  }
}
