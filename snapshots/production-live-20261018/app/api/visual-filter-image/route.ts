import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function isAllowedImageUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "pbs.twimg.com";
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse(null, { status: 404 });
  }

  const source = request.nextUrl.searchParams.get("url") ?? "";

  if (!isAllowedImageUrl(source)) {
    return NextResponse.json(
      { success: false, error: "許可されていない画像URLです。" },
      { status: 400 }
    );
  }

  try {
    const response = await fetch(source, {
      cache: "no-store",
      redirect: "error",
      headers: { "User-Agent": "x-video-rank-visual-filter-preview/1.0" },
    });

    if (!response.ok) {
      return NextResponse.json(
        { success: false, error: `画像取得に失敗しました (${response.status})` },
        { status: 502 }
      );
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("image/")) {
      return NextResponse.json(
        { success: false, error: "画像ではない応答を拒否しました。" },
        { status: 415 }
      );
    }

    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_IMAGE_BYTES) {
      return NextResponse.json(
        { success: false, error: "画像サイズが上限を超えています。" },
        { status: 413 }
      );
    }

    const body = await response.arrayBuffer();
    if (body.byteLength > MAX_IMAGE_BYTES) {
      return NextResponse.json(
        { success: false, error: "画像サイズが上限を超えています。" },
        { status: 413 }
      );
    }

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Visual filter image proxy error:", error);
    return NextResponse.json(
      { success: false, error: "画像取得中にエラーが発生しました。" },
      { status: 502 }
    );
  }
}
