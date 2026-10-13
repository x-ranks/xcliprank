import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  publishXPost,
  uploadXImage,
  verifyXPostingAccount,
} from "../../../lib/x-publish";
import { isCronAuthorized } from "../../../lib/cron-auth";
import { applyPromotionMosaic } from "../../../lib/x-image-safety";
import { SITE_URL } from "../../../lib/seo";
import { supabaseAdmin } from "../../../lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VARIANTS = ["a", "b", "c"] as const;
type PromotionVariant = (typeof VARIANTS)[number];

function unauthorized() {
  return NextResponse.json(
    { ok: false, error: "認証に失敗しました" },
    { status: 401, headers: { "cache-control": "no-store" } }
  );
}

type RankingPreview = {
  rank: number;
  xPostId: string;
  imageUrl: string;
  author: string;
  tier: string;
};

type RankingSnapshot = {
  count: number;
  topPostIds: string[];
  previews: RankingPreview[];
};

function isVariant(value: unknown): value is PromotionVariant {
  return typeof value === "string" && VARIANTS.includes(value as PromotionVariant);
}

function safePreviewUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "pbs.twimg.com"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function japanDateParts() {
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: "year" | "month" | "day") =>
    formatted.find((part) => part.type === type)?.value ?? "";
  const iso = `${value("year")}-${value("month")}-${value("day")}`;
  return {
    iso,
    compact: iso.replaceAll("-", ""),
    display: new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      month: "long",
      day: "numeric",
    }).format(new Date()),
  };
}

async function rankingSnapshot(): Promise<RankingSnapshot> {
  const response = await fetch(`${SITE_URL}/api/rankings?range=daily`, {
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error("24時間ランキングを取得できませんでした。");
  }

  const posts = Array.isArray(payload.data) ? payload.data : [];
  const topPosts = posts.slice(0, 3) as Record<string, unknown>[];
  const topPostIds = topPosts
    .map((post) =>
      typeof post.x_post_id === "string" ? post.x_post_id : ""
    )
    .filter(Boolean);
  const previews = topPosts
    .map((post, index) => {
      const imageUrl = safePreviewUrl(post.preview_image_url);
      const xPostId =
        typeof post.x_post_id === "string" ? post.x_post_id : "";
      if (!imageUrl || !xPostId) return null;
      return {
        rank: index + 1,
        xPostId,
        imageUrl,
        author:
          typeof post.author_username === "string"
            ? post.author_username
            : "",
        tier:
          typeof post.adult_tier === "string" ? post.adult_tier : "",
      };
    })
    .filter(
      (preview: RankingPreview | null): preview is RankingPreview =>
        Boolean(preview)
    );

  return {
    count: Number.isFinite(Number(payload.count))
      ? Number(payload.count)
      : posts.length,
    topPostIds,
    previews,
  };
}

async function downloadPreview(preview: RankingPreview) {
  const response = await fetch(preview.imageUrl, {
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`ランキング${preview.rank}位の画像を取得できませんでした。`);
  }

  const contentType = response.headers.get("content-type")?.split(";")[0];
  if (
    contentType !== "image/jpeg" &&
    contentType !== "image/png" &&
    contentType !== "image/webp"
  ) {
    throw new Error(`ランキング${preview.rank}位の画像形式に対応していません。`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > 5 * 1024 * 1024) {
    throw new Error(`ランキング${preview.rank}位の画像サイズに対応していません。`);
  }

  const mosaicked = await applyPromotionMosaic(bytes);
  return {
    bytes: new Uint8Array(mosaicked),
    contentType: "image/jpeg" as const,
    filename: `ranking-${preview.rank}-mosaic.jpg`,
  };
}

function promotionUrl(variant: PromotionVariant) {
  const date = japanDateParts();
  const utmContent = `top3_${variant}_${date.compact}`;
  return {
    utmContent,
    url: `${SITE_URL}/ranking/daily?utm_source=x&utm_medium=social&utm_campaign=daily_ranking&utm_content=${utmContent}`,
  };
}

function createDraft(variant: PromotionVariant, count: number) {
  const date = japanDateParts();
  const tracked = promotionUrl(variant);
  const countText = count > 0 ? `${Math.min(count, 50)}件から` : "ランキングから";

  const drafts: Record<PromotionVariant, { label: string; text: string }> = {
    a: {
      label: "A：更新・速報型",
      text: `【${date.display}】24時間動画ランキング更新\n\n${countText}注目のTOP3をピックアップしました。\n▶ ${tracked.url}\n\n#XCLIPRANK #動画ランキング`,
    },
    b: {
      label: "B：問いかけ型",
      text: `今日の人気動画、もう見ましたか？\n\n24時間ランキングのTOP3はこちら。\n▶ ${tracked.url}\n\n#XCLIPRANK`,
    },
    c: {
      label: "C：発見・回遊型",
      text: `次に見る動画を探すなら。\n\n24時間ランキングから注目のTOP3をまとめました。\n▶ ${tracked.url}\n\n#XCLIPRANK #動画ランキング`,
    },
  };

  return {
    id: variant,
    label: drafts[variant].label,
    text: drafts[variant].text,
    characterCount: drafts[variant].text.length,
    targetUrl: tracked.url,
    utmContent: tracked.utmContent,
  };
}

function snapshotSignature(snapshot: RankingSnapshot) {
  return createHash("sha256")
    .update(snapshot.topPostIds.join(":"))
    .digest("hex");
}

async function promotionHistory() {
  const { data, error } = await supabaseAdmin()
    .from("x_promotion_logs")
    .select(
      "id,created_at,status,trigger_source,variant,ranking_date,utm_content,x_post_url,media_count,error_message"
    )
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) {
    if (error.code === "42P01") return { ready: false, rows: [] };
    throw error;
  }
  return { ready: true, rows: data ?? [] };
}

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) return unauthorized();

  try {
    if (request.nextUrl.searchParams.get("mode") === "verify") {
      const account = await verifyXPostingAccount();
      return NextResponse.json(
        {
          ok: true,
          account: {
            id: account.id,
            name: account.name,
            username: account.username,
          },
        },
        { headers: { "cache-control": "no-store" } }
      );
    }

    const snapshot = await rankingSnapshot();
    const history = await promotionHistory();
    const variants = VARIANTS.map((variant) =>
      createDraft(variant, snapshot.count)
    );
    return NextResponse.json(
      {
        ok: true,
        variants,
        selectedVariant: variants[0].id,
        draft: variants[0].text,
        characterCount: variants[0].characterCount,
        rankingCount: snapshot.count,
        mediaPreview: snapshot.previews,
        historyReady: history.ready,
        history: history.rows,
      },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "取得に失敗しました",
      },
      { status: 500, headers: { "cache-control": "no-store" } }
    );
  }
}

export async function POST(request: NextRequest) {
  if (!isCronAuthorized(request)) return unauthorized();

  let logId: number | null = null;
  let xPostPublished = false;
  try {
    const body = await request.json();
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    const variant: PromotionVariant = isVariant(body?.variant)
      ? body.variant
      : "a";

    if (body?.confirmation !== "POST_TO_X") {
      return NextResponse.json(
        { ok: false, error: "投稿確認が必要です" },
        { status: 400 }
      );
    }
    if (!text || text.length > 280) {
      return NextResponse.json(
        { ok: false, error: "投稿文は1〜280文字で入力してください" },
        { status: 400 }
      );
    }

    const tracked = promotionUrl(variant);
    if (!text.includes(tracked.url)) {
      return NextResponse.json(
        {
          ok: false,
          error: "選択した投稿パターンの計測URLを本文に残してください",
        },
        { status: 400 }
      );
    }

    const snapshot = await rankingSnapshot();
    if (snapshot.previews.length !== 3 || snapshot.topPostIds.length !== 3) {
      throw new Error("ランキングTOP3のサムネイルを3枚取得できませんでした。");
    }

    const date = japanDateParts();
    const signature = snapshotSignature(snapshot);
    const dedupeKey = `${date.iso}:${signature}`;
    const { data: reservation, error: reservationError } = await supabaseAdmin()
      .from("x_promotion_logs")
      .insert({
        status: "publishing",
        trigger_source: "manual",
        variant,
        ranking_date: date.iso,
        ranking_signature: signature,
        dedupe_key: dedupeKey,
        ranking_count: snapshot.count,
        top_post_ids: snapshot.topPostIds,
        target_url: tracked.url,
        utm_content: tracked.utmContent,
        draft_text: text,
      })
      .select("id")
      .single();

    if (reservationError?.code === "23505") {
      const { data: previous } = await supabaseAdmin()
        .from("x_promotion_logs")
        .select("status,x_post_url,created_at")
        .eq("dedupe_key", dedupeKey)
        .maybeSingle();
      return NextResponse.json(
        {
          ok: false,
          duplicate: true,
          error: "同じ日の同じランキングTOP3は既に投稿済み、または投稿処理中です。",
          previous: previous ?? null,
        },
        { status: 409, headers: { "cache-control": "no-store" } }
      );
    }
    if (reservationError) throw reservationError;
    logId = Number(reservation.id);

    const mediaIds: string[] = [];
    for (const preview of snapshot.previews) {
      const image = await downloadPreview(preview);
      mediaIds.push(
        await uploadXImage(image.bytes, image.contentType, image.filename)
      );
    }

    const post = await publishXPost(text, mediaIds);
    xPostPublished = true;
    const postUrl = `https://x.com/i/web/status/${post.id}`;
    const { error: completionError } = await supabaseAdmin()
      .from("x_promotion_logs")
      .update({
        status: "success",
        updated_at: new Date().toISOString(),
        x_post_id: post.id,
        x_post_url: postUrl,
        media_count: mediaIds.length,
        error_message: null,
      })
      .eq("id", logId);

    return NextResponse.json(
      {
        ok: true,
        mosaicApplied: true,
        variant,
        utmContent: tracked.utmContent,
        loggingWarning: completionError
          ? "投稿は成功しましたが、履歴の完了更新に失敗しました。"
          : null,
        post: {
          id: post.id,
          url: postUrl,
          mediaCount: mediaIds.length,
        },
      },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Xへの投稿に失敗しました";
    if (logId !== null && !xPostPublished) {
      await supabaseAdmin()
        .from("x_promotion_logs")
        .update({
          status: "failed",
          updated_at: new Date().toISOString(),
          dedupe_key: null,
          error_message: message.slice(0, 1000),
        })
        .eq("id", logId);
    }
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500, headers: { "cache-control": "no-store" } }
    );
  }
}
