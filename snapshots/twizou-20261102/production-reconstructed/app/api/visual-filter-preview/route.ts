import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../lib/supabase-admin";

export const dynamic = "force-dynamic";

type PreviewPost = {
  id: number;
  x_post_id: string;
  author_username: string | null;
  text: string | null;
  created_at: string | null;
  preview_image_url: string | null;
  video_url: string | null;
  possibly_sensitive: boolean | null;
  adult_tier: string | null;
  content_category: string | null;
  content_filter_score: number | null;
  content_filter_reason: string | null;
};

type SafetyReason = "未成年" | "流出" | "盗撮";

const PAGE_SIZE = 1000;

function safetyReasons(text: string): SafetyReason[] {
  const normalized = text.normalize("NFKC").toLowerCase();
  // t.co等のURLに偶然含まれる "jk" / "jc" は未成年シグナルにしない。
  const withoutUrls = normalized.replace(/https?:\/\/\S+/g, " ");
  const reasons: SafetyReason[] = [];

  if (
    /未成年|児童|小学生|中学生|高校生/.test(withoutUrls) ||
    /(?:^|[^a-z])j[ck](?:$|[^a-z])/.test(withoutUrls)
  ) {
    reasons.push("未成年");
  }

  if (/流出|流失/.test(normalized)) {
    reasons.push("流出");
  }

  if (/盗撮|勝手に撮影/.test(normalized)) {
    reasons.push("盗撮");
  }

  return reasons;
}

function sampleReasons(post: PreviewPost): string[] {
  const normalized = (post.text ?? "").normalize("NFKC").toLowerCase();
  const reasons: string[] = [];

  if (post.content_category === "PROMO") {
    reasons.push("既存分類: 宣伝・サンプル");
  }

  if (post.content_category === "SOFT_GRAVURE") {
    reasons.push("既存分類: グラビア作品");
  }

  if (/サンプル|sample|preview|予告編/.test(normalized)) {
    reasons.push("サンプル表記");
  }

  if (/購入は(?:こちら|コチラ)|販売中|発売中|作品詳細|fanza/.test(normalized)) {
    reasons.push("販売・購入誘導");
  }

  return Array.from(new Set(reasons));
}

function excerpt(text: string, maxLength = 180) {
  const singleLine = text.replace(/\s+/g, " ").trim();
  return singleLine.length <= maxLength
    ? singleLine
    : `${singleLine.slice(0, maxLength)}…`;
}

async function fetchAllPreviewPosts() {
  const supabase = supabaseAdmin();
  const all: PreviewPost[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("posts")
      .select(
        "id,x_post_id,author_username,text,created_at,preview_image_url,video_url,possibly_sensitive,adult_tier,content_category,content_filter_score,content_filter_reason"
      )
      .eq("is_visible", true)
      .not("video_url", "is", null)
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      throw error;
    }

    const page = (data ?? []) as PreviewPost[];
    all.push(...page);

    if (page.length < PAGE_SIZE) {
      break;
    }
  }

  return all;
}

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse(null, { status: 404 });
  }

  try {
    const posts = await fetchAllPreviewPosts();
    const safety = posts
      .map((post) => ({ post, reasons: safetyReasons(post.text ?? "") }))
      .filter(({ reasons }) => reasons.length > 0);
    const safetyIds = new Set(safety.map(({ post }) => post.id));

    const samples = posts
      .filter((post) => !safetyIds.has(post.id))
      .map((post) => ({ post, reasons: sampleReasons(post) }))
      .filter(({ reasons }) => reasons.length > 0)
      .slice(0, 30);
    const sampleIds = new Set(samples.map(({ post }) => post.id));

    const visual = posts
      .filter(
        (post) =>
          !safetyIds.has(post.id) &&
          !sampleIds.has(post.id) &&
          Boolean(post.preview_image_url)
      )
      .slice(0, 50);

    return NextResponse.json({
      success: true,
      scannedCount: posts.length,
      safetyCount: safety.length,
      sampleCandidateCount: samples.length,
      visualCandidateCount: visual.length,
      safety: safety.slice(0, 100).map(({ post, reasons }) => ({
        id: post.id,
        xPostId: post.x_post_id,
        authorUsername: post.author_username,
        createdAt: post.created_at,
        textExcerpt: excerpt(post.text ?? ""),
        reasons,
        // Safety対象には画像・動画・投稿リンクを一切返さない。
      })),
      samples: samples.map(({ post, reasons }) => ({
        id: post.id,
        xPostId: post.x_post_id,
        authorUsername: post.author_username,
        createdAt: post.created_at,
        textExcerpt: excerpt(post.text ?? ""),
        previewImageUrl: post.preview_image_url,
        adultTier: post.adult_tier,
        contentCategory: post.content_category,
        contentFilterScore: post.content_filter_score,
        contentFilterReason: post.content_filter_reason,
        reasons,
      })),
      visual: visual.map((post) => ({
        id: post.id,
        xPostId: post.x_post_id,
        authorUsername: post.author_username,
        createdAt: post.created_at,
        textExcerpt: excerpt(post.text ?? ""),
        previewImageUrl: post.preview_image_url,
        videoUrl: post.video_url,
        adultTier: post.adult_tier,
        contentCategory: post.content_category,
        possiblySensitive: post.possibly_sensitive,
      })),
    });
  } catch (error) {
    console.error("Visual filter preview GET error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
