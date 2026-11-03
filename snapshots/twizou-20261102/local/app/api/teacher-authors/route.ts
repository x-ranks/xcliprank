import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "../../../lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ExpectedTier = "S" | "A";
type ReviewTier = "S" | "A" | "OTHER" | "X";

type TrainingReview = {
  tier: ReviewTier;
  reason: string | null;
  reviewedAt: string;
};

type TrainingPost = {
  xPostId: string;
  authorUsername: string;
  text: string;
  createdAt: string | null;
  xUrl: string | null;
  previewImageUrl: string | null;
  videoUrl: string | null;
  views: number;
  likes: number;
  reposts: number;
  possiblySensitive: boolean;
  safetyReasons: string[];
  review: TrainingReview | null;
};

type TeacherAuthor = {
  username: string;
  expectedTier: ExpectedTier;
  addedAt: string;
  refreshedAt: string;
  posts: TrainingPost[];
};

type TeacherStore = {
  version: 1;
  authors: TeacherAuthor[];
};

const STORE_DIRECTORY = path.join(process.cwd(), "data");
const STORE_PATH = path.join(STORE_DIRECTORY, "teacher-authors.json");
const TEMP_STORE_PATH = path.join(STORE_DIRECTORY, "teacher-authors.tmp.json");
const MODEL_PATH = path.join(STORE_DIRECTORY, "visual-preference-model.json");
const RETRAINING_THRESHOLD = 50;
const POLICY_VIOLATION_REASON = "policy_violation";

function emptyStore(): TeacherStore {
  return { version: 1, authors: [] };
}

async function readStore(): Promise<TeacherStore> {
  try {
    return JSON.parse(await readFile(STORE_PATH, "utf8")) as TeacherStore;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return emptyStore();
    }
    throw error;
  }
}

async function saveStore(store: TeacherStore) {
  await mkdir(STORE_DIRECTORY, { recursive: true });
  await writeFile(TEMP_STORE_PATH, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  await rename(TEMP_STORE_PATH, STORE_PATH);
}

async function trainingStatus(authors: TeacherAuthor[]) {
  let modelTrainedAt: string | null = null;
  try {
    const model = JSON.parse(await readFile(MODEL_PATH, "utf8"));
    if (typeof model?.trainedAt === "string") modelTrainedAt = model.trainedAt;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const trainedAtTime = modelTrainedAt ? new Date(modelTrainedAt).getTime() : Number.NEGATIVE_INFINITY;
  const reviews = authors.flatMap((author) =>
    author.posts
      .map((post) => post.review)
      .filter(
        (review): review is TrainingReview =>
          Boolean(review) && review?.reason !== POLICY_VIOLATION_REASON
      )
  );
  const reviewsSinceTraining = reviews.filter(
    (review) => new Date(review.reviewedAt).getTime() > trainedAtTime
  ).length;

  return {
    modelTrainedAt,
    totalReviewed: reviews.length,
    reviewsSinceTraining,
    threshold: RETRAINING_THRESHOLD,
    remainingUntilRetraining: Math.max(0, RETRAINING_THRESHOLD - reviewsSinceTraining),
    needsRetraining: reviewsSinceTraining >= RETRAINING_THRESHOLD,
  };
}

function normalizeUsername(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const fromUrl = trimmed.match(/(?:x\.com|twitter\.com)\/([A-Za-z0-9_]{1,15})/i)?.[1];
  const normalized = (fromUrl ?? trimmed.replace(/^@/, "")).trim();
  return /^[A-Za-z0-9_]{1,15}$/.test(normalized) ? normalized : null;
}

function safetyReasons(text: string) {
  const normalized = text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ");
  const reasons: string[] = [];

  if (
    /未成年|児童|小学生|中学生|高校生/.test(normalized) ||
    /(?:^|[^a-z])j[ck](?:$|[^a-z])/.test(normalized)
  ) reasons.push("未成年");
  if (/流出|流失/.test(normalized)) reasons.push("流出");
  if (/盗撮|勝手に撮影/.test(normalized)) reasons.push("盗撮");

  return reasons;
}

function publicStore(store: TeacherStore) {
  return {
    ...store,
    authors: store.authors.map((author) => ({
      ...author,
      posts: author.posts.map((post) =>
        post.safetyReasons.length > 0
          ? {
              ...post,
              xUrl: null,
              previewImageUrl: null,
              videoUrl: null,
            }
          : post
      ),
    })),
  };
}

function trainingAuthors(authors: TeacherAuthor[]) {
  return authors.map((author) => ({
    ...author,
    posts: author.posts.filter(
      (post) => post.review?.reason !== POLICY_VIOLATION_REASON
    ),
  }));
}

async function syncCuratedAuthors(store: TeacherStore) {
  const supabase = supabaseAdmin();
  const { data: curatedAuthors, error: authorError } = await supabase
    .from("authors")
    .select("x_author_id,username,curated_expected_tier,curated_added_at,curated_last_collected_at")
    .eq("is_curated", true)
    .eq("curated_status", "active")
    .order("curated_added_at", { ascending: true });
  if (authorError) throw authorError;

  const authors = curatedAuthors ?? [];
  const authorIds = authors.map((author) => String(author.x_author_id));
  const rows: any[] = [];
  const pageSize = 1000;

  for (let from = 0; authorIds.length > 0; from += pageSize) {
    const { data, error } = await supabase
      .from("posts")
      .select("x_post_id,author_id,author_username,text,created_at,x_url,preview_image_url,video_url,views,likes,reposts,possibly_sensitive,review_required")
      .in("author_id", authorIds)
      .eq("moderation_blocked", false)
      .not("video_url", "is", null)
      .order("created_at", { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if ((data ?? []).length < pageSize) break;
  }

  const previousByPostId = new Map(
    store.authors.flatMap((author) =>
      author.posts.map((post) => [post.xPostId, post.review] as const)
    )
  );
  const postsByAuthor = new Map<string, any[]>();
  for (const post of rows) {
    const authorId = String(post.author_id);
    const list = postsByAuthor.get(authorId) ?? [];
    list.push(post);
    postsByAuthor.set(authorId, list);
  }

  const now = new Date().toISOString();
  const currentAuthors = authors.map((author): TeacherAuthor => {
    const posts = (postsByAuthor.get(String(author.x_author_id)) ?? [])
      .slice(0, 50)
      .map((post): TrainingPost => {
        const reasons = safetyReasons(String(post.text ?? ""));
        if (post.review_required === true && reasons.length === 0) reasons.push("安全確認");
        const quarantined = reasons.length > 0;
        return {
          xPostId: String(post.x_post_id),
          authorUsername: String(post.author_username ?? author.username),
          text: String(post.text ?? ""),
          createdAt: post.created_at ?? null,
          xUrl: quarantined ? null : post.x_url ?? null,
          previewImageUrl: quarantined ? null : post.preview_image_url ?? null,
          videoUrl: quarantined ? null : post.video_url ?? null,
          views: Number(post.views ?? 0),
          likes: Number(post.likes ?? 0),
          reposts: Number(post.reposts ?? 0),
          possiblySensitive: post.possibly_sensitive === true,
          safetyReasons: reasons,
          review: previousByPostId.get(String(post.x_post_id)) ?? null,
        };
      });
    return {
      username: String(author.username),
      expectedTier: author.curated_expected_tier === "A" ? "A" : "S",
      addedAt: author.curated_added_at ?? now,
      refreshedAt: author.curated_last_collected_at ?? now,
      posts,
    };
  });

  const currentNames = new Set(currentAuthors.map((author) => author.username.toLowerCase()));
  const legacyAuthors = store.authors.filter(
    (author) =>
      !currentNames.has(author.username.toLowerCase()) &&
      author.posts.some((post) => post.review)
  );
  const mergedStore: TeacherStore = {
    version: 1,
    authors: [...currentAuthors, ...legacyAuthors],
  };
  await saveStore(mergedStore);

  return { mergedStore, currentNames };
}

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse(null, { status: 404 });
  }

  try {
    const { mergedStore, currentNames } = await syncCuratedAuthors(await readStore());
    const allPublicAuthors = publicStore(mergedStore).authors;
    return NextResponse.json({
      success: true,
      store: {
        version: 1,
        authors: allPublicAuthors.filter((author) => currentNames.has(author.username.toLowerCase())),
      },
      trainingAuthors: trainingAuthors(allPublicAuthors),
      legacyAuthorCount: allPublicAuthors.filter((author) => !currentNames.has(author.username.toLowerCase())).length,
      trainingStatus: await trainingStatus(allPublicAuthors),
    });
  } catch (error) {
    console.error("Teacher authors GET error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "取得に失敗しました" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse(null, { status: 404 });
  }

  try {
    const body = await request.json();
    const action = body.action;
    const store = await readStore();

    if (action === "review") {
      const username = normalizeUsername(body.username);
      const tier = body.tier as ReviewTier;
      if (!username || !["S", "A", "OTHER", "X"].includes(tier)) {
        return NextResponse.json({ success: false, error: "評価内容が正しくありません。" }, { status: 400 });
      }

      const author = store.authors.find(
        (item) => item.username.toLowerCase() === username.toLowerCase()
      );
      const post = author?.posts.find((item) => item.xPostId === body.xPostId);
      if (!author || !post || post.safetyReasons.length > 0) {
        return NextResponse.json({ success: false, error: "評価対象が見つかりません。" }, { status: 404 });
      }

      post.review = {
        tier,
        reason: typeof body.reason === "string" && body.reason.trim() ? body.reason.trim().slice(0, 80) : null,
        reviewedAt: new Date().toISOString(),
      };

      if (post.review.reason === POLICY_VIOLATION_REASON) {
        const reviewedAt = post.review.reviewedAt;
        const { data: updatedPost, error: updateError } = await supabaseAdmin()
          .from("posts")
          .update({
            is_visible: false,
            review_required: true,
            moderation_blocked: true,
            moderation_reason: "policy_violation",
            moderation_source: "teacher_review",
            moderated_at: reviewedAt,
            manual_tier: "X",
            manual_category: "policy_violation",
            manual_review_note: "teacher review; verdict=policy_violation",
            manual_reviewed_at: reviewedAt,
          })
          .eq("x_post_id", post.xPostId)
          .select("x_post_id")
          .maybeSingle();
        if (updateError) throw updateError;
        if (!updatedPost) {
          return NextResponse.json(
            { success: false, error: "ランキング除外対象の投稿が見つかりません。" },
            { status: 404 }
          );
        }
      }
      await saveStore(store);
      return NextResponse.json({
        success: true,
        review: post.review,
        trainingStatus: await trainingStatus(publicStore(store).authors),
      });
    }

    return NextResponse.json({ success: false, error: "未対応の操作です。" }, { status: 400 });
  } catch (error) {
    console.error("Teacher authors POST error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "処理に失敗しました" },
      { status: 500 }
    );
  }
}
