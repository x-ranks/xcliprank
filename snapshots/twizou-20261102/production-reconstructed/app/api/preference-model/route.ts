import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL_DIRECTORY = path.join(process.cwd(), "data");
const MODEL_PATH = path.join(MODEL_DIRECTORY, "visual-preference-model.json");
const MAX_MODEL_BYTES = 8 * 1024 * 1024;

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse(null, { status: 404 });
  }

  try {
    const model = JSON.parse(await readFile(MODEL_PATH, "utf8"));
    return NextResponse.json({ success: true, model });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json({ success: true, model: null });
    }
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "モデル取得に失敗しました" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse(null, { status: 404 });
  }

  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_MODEL_BYTES) {
      return NextResponse.json({ success: false, error: "モデルファイルが大きすぎます。" }, { status: 413 });
    }

    const model = JSON.parse(raw);
    if (
      model?.version !== 1 ||
      model?.featureSpec?.endpoint !== "flatten_1" ||
      !Array.isArray(model?.normalization?.mean) ||
      !Array.isArray(model?.normalization?.std) ||
      !Array.isArray(model?.weights) ||
      model.weights.length === 0 ||
      model.weights.length !== model.normalization.mean.length ||
      model.weights.length !== model.normalization.std.length
    ) {
      return NextResponse.json({ success: false, error: "モデル形式が正しくありません。" }, { status: 400 });
    }

    await mkdir(MODEL_DIRECTORY, { recursive: true });
    await writeFile(MODEL_PATH, `${JSON.stringify(model, null, 2)}\n`, "utf8");
    return NextResponse.json({ success: true, path: "data/visual-preference-model.json" });
  } catch (error) {
    console.error("Preference model POST error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "モデル保存に失敗しました" },
      { status: 500 }
    );
  }
}
