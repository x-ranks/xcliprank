import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const ALLOWED_FILES = new Set(["model.json", "group1-shard1of1.bin"]);

export async function GET(
  _request: Request,
  context: { params: Promise<{ file: string }> }
) {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse(null, { status: 404 });
  }

  const { file } = await context.params;
  if (!ALLOWED_FILES.has(file)) {
    return new NextResponse(null, { status: 404 });
  }

  try {
    const modelPath = path.join(process.cwd(), "visual-filter-model", file);
    const body = await readFile(modelPath);

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": file.endsWith(".json")
          ? "application/json"
          : "application/octet-stream",
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Visual filter model read error:", error);
    return NextResponse.json(
      { success: false, error: "ローカル判定モデルを読み込めませんでした。" },
      { status: 500 }
    );
  }
}
