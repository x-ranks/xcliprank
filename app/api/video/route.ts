import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function isAllowedVideoUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);

    return (
      url.protocol === "https:" &&
      (
        url.hostname === "video.twimg.com" ||
        url.hostname.endsWith(".video.twimg.com")
      )
    );
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  const rawUrl = req.nextUrl.searchParams.get("url");

  if (!rawUrl) {
    return NextResponse.json(
      { error: "Missing video URL" },
      { status: 400 }
    );
  }

  if (!isAllowedVideoUrl(rawUrl)) {
    return NextResponse.json(
      { error: "Video host is not allowed" },
      { status: 400 }
    );
  }

  try {
    const range = req.headers.get("range");

    const headers: HeadersInit = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/147 Safari/537.36",
      "Accept": "*/*",
      "Accept-Encoding": "identity"
    };

    if (range) {
      headers["Range"] = range;
    }

    const upstream = await fetch(rawUrl, {
      headers,
      redirect: "follow",
      cache: "no-store"
    });

    if (!upstream.ok && upstream.status !== 206) {
      const body = await upstream.text().catch(() => "");

      return NextResponse.json(
        {
          error: "Upstream video request failed",
          status: upstream.status,
          detail: body.slice(0, 300)
        },
        { status: upstream.status }
      );
    }

    const responseHeaders = new Headers();

    const contentType =
      upstream.headers.get("content-type") || "video/mp4";

    responseHeaders.set(
      "Content-Type",
      contentType
    );

    const contentLength =
      upstream.headers.get("content-length");

    if (contentLength) {
      responseHeaders.set(
        "Content-Length",
        contentLength
      );
    }

    const contentRange =
      upstream.headers.get("content-range");

    if (contentRange) {
      responseHeaders.set(
        "Content-Range",
        contentRange
      );
    }

    const acceptRanges =
      upstream.headers.get("accept-ranges");

    if (acceptRanges) {
      responseHeaders.set(
        "Accept-Ranges",
        acceptRanges
      );
    } else {
      responseHeaders.set(
        "Accept-Ranges",
        "bytes"
      );
    }

    responseHeaders.set(
      "Cache-Control",
      "private, max-age=300"
    );

    return new NextResponse(
      upstream.body,
      {
        status: upstream.status,
        headers: responseHeaders
      }
    );
  } catch (error) {
    console.error("VIDEO PROXY ERROR:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unknown video proxy error"
      },
      { status: 500 }
    );
  }
}