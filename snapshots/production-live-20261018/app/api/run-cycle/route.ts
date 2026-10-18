import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function authorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    return false;
  }

  const auth = req.headers.get("authorization");
  const querySecret = req.nextUrl.searchParams.get("secret");

  return (
    auth === `Bearer ${secret}` ||
    querySecret === secret
  );
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    const secret = process.env.CRON_SECRET;

    if (!secret) {
      throw new Error("Missing CRON_SECRET.");
    }

    /*
     * localhost / 本番環境のどちらでも
     * 現在のアプリ自身を呼べるようにする
     */
    const origin = req.nextUrl.origin;

    /*
     * =========================
     * 1. Priority Collector
     * =========================
     */
    console.log("RUN CYCLE: collect-priority start");

    const collectResponse = await fetch(
      `${origin}/api/collect-priority`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${secret}`
        },
        cache: "no-store"
      }
    );

    const collectText =
      await collectResponse.text();

    let collectResult;

    try {
      collectResult =
        JSON.parse(collectText);
    } catch {
      collectResult = {
        raw: collectText
      };
    }

    if (!collectResponse.ok) {
      throw new Error(
        `collect-priority failed (${collectResponse.status}): ${collectText}`
      );
    }

    console.log(
      "RUN CYCLE: collect-priority complete",
      collectResult
    );

    /*
     * =========================
     * 2. Recount Authors
     * =========================
     */
    console.log("RUN CYCLE: recount-authors start");

    const recountResponse = await fetch(
      `${origin}/api/recount-authors`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${secret}`
        },
        cache: "no-store"
      }
    );

    const recountText =
      await recountResponse.text();

    let recountResult;

    try {
      recountResult =
        JSON.parse(recountText);
    } catch {
      recountResult = {
        raw: recountText
      };
    }

    if (!recountResponse.ok) {
      throw new Error(
        `recount-authors failed (${recountResponse.status}): ${recountText}`
      );
    }

    console.log(
      "RUN CYCLE: recount-authors complete",
      recountResult
    );

    /*
     * =========================
     * 完了
     * =========================
     */
    return NextResponse.json({
      ok: true,

      cycleCompletedAt:
        new Date().toISOString(),

      collectPriority:
        collectResult,

      recountAuthors:
        recountResult
    });
  } catch (error) {
    console.error(
      "RUN CYCLE ERROR:",
      error
    );

    return NextResponse.json(
      {
        ok: false,

        error:
          error instanceof Error
            ? error.message
            : JSON.stringify(error)
      },
      {
        status: 500
      }
    );
  }
}