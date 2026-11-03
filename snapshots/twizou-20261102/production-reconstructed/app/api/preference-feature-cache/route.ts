import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_DIRECTORY = path.join(process.cwd(), "data", "visual-preference-feature-cache");
const MAX_IDS = 10_000;
const MAX_STORE_ITEMS = 20;
const FAILURE_RETRY_DAYS = 7;

type CacheEntry = {
  version: 1;
  featureSpec: string;
  xPostId: string;
  kind: "success" | "failure";
  featuresBase64?: string;
  dimension?: number;
  error?: string;
  cachedAt: string;
  retryAfter?: string;
};

function validFeatureSpec(value: unknown) {
  return typeof value === "string" && /^[A-Za-z0-9_.-]{1,120}$/.test(value) ? value : null;
}

function validXPostId(value: unknown) {
  return typeof value === "string" && /^\d{1,30}$/.test(value) ? value : null;
}

function cachePath(xPostId: string) {
  return path.join(CACHE_DIRECTORY, `${xPostId}.json`);
}

async function readEntry(xPostId: string) {
  try {
    return JSON.parse(await readFile(cachePath(xPostId), "utf8")) as CacheEntry;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    return null;
  }
}

export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === "production") return new NextResponse(null, { status: 404 });

  try {
    const body = await request.json();
    const featureSpec = validFeatureSpec(body.featureSpec);
    if (!featureSpec) {
      return NextResponse.json({ success: false, error: "視覚特徴の形式が正しくありません。" }, { status: 400 });
    }

    if (body.action === "load") {
      if (!Array.isArray(body.xPostIds) || body.xPostIds.length > MAX_IDS) {
        return NextResponse.json({ success: false, error: "読み込む投稿数が正しくありません。" }, { status: 400 });
      }
      const xPostIds = Array.from(new Set(body.xPostIds.map(validXPostId).filter(Boolean))) as string[];
      if (xPostIds.length !== new Set(body.xPostIds).size) {
        return NextResponse.json({ success: false, error: "投稿IDが正しくありません。" }, { status: 400 });
      }

      const items: CacheEntry[] = [];
      const deferredFailures: CacheEntry[] = [];
      const now = Date.now();
      for (let index = 0; index < xPostIds.length; index += 100) {
        const entries = await Promise.all(xPostIds.slice(index, index + 100).map(readEntry));
        for (const entry of entries) {
          if (!entry || entry.version !== 1 || entry.featureSpec !== featureSpec) continue;
          if (entry.kind === "success" && entry.featuresBase64 && entry.dimension) {
            items.push(entry);
          } else if (entry.kind === "failure" && entry.retryAfter && Date.parse(entry.retryAfter) > now) {
            deferredFailures.push(entry);
          }
        }
      }
      return NextResponse.json({ success: true, items, deferredFailures });
    }

    if (body.action === "store") {
      if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > MAX_STORE_ITEMS) {
        return NextResponse.json({ success: false, error: "保存する特徴数が正しくありません。" }, { status: 400 });
      }
      const now = new Date();
      const entries: CacheEntry[] = [];
      for (const item of body.items as Array<Record<string, unknown>>) {
        const xPostId = validXPostId(item.xPostId);
        if (!xPostId || (item.kind !== "success" && item.kind !== "failure")) {
          return NextResponse.json({ success: false, error: "キャッシュ項目が正しくありません。" }, { status: 400 });
        }

        let entry: CacheEntry;
        if (item.kind === "success") {
          const dimension = Number(item.dimension);
          const featuresBase64 = typeof item.featuresBase64 === "string" ? item.featuresBase64 : "";
          const bytes = Buffer.from(featuresBase64, "base64");
          if (!Number.isInteger(dimension) || dimension < 100 || dimension > 10_000 || bytes.length !== dimension * 4) {
            return NextResponse.json({ success: false, error: "視覚特徴データが正しくありません。" }, { status: 400 });
          }
          entry = { version: 1, featureSpec, xPostId, kind: "success", featuresBase64, dimension, cachedAt: now.toISOString() };
        } else {
          const error = typeof item.error === "string" ? item.error.slice(0, 300) : "特徴抽出失敗";
          entry = {
            version: 1,
            featureSpec,
            xPostId,
            kind: "failure",
            error,
            cachedAt: now.toISOString(),
            retryAfter: new Date(now.getTime() + FAILURE_RETRY_DAYS * 24 * 60 * 60 * 1000).toISOString(),
          };
        }
        entries.push(entry);
      }
      await mkdir(CACHE_DIRECTORY, { recursive: true });
      await Promise.all(entries.map((entry) =>
        writeFile(cachePath(entry.xPostId), `${JSON.stringify(entry)}\n`, "utf8")
      ));
      return NextResponse.json({ success: true, storedCount: body.items.length });
    }

    return NextResponse.json({ success: false, error: "未対応の操作です。" }, { status: 400 });
  } catch (error) {
    console.error("Preference feature cache error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "視覚特徴キャッシュの処理に失敗しました。" },
      { status: 500 }
    );
  }
}
