type XPost = {
  id: string;
  text: string;
  author_id?: string;
  created_at?: string;
  possibly_sensitive?: boolean;
  public_metrics?: {
    retweet_count?: number;
    reply_count?: number;
    like_count?: number;
    quote_count?: number;
    bookmark_count?: number;
    impression_count?: number;
  };
  attachments?: { media_keys?: string[] };
};

type XUser = { id: string; username: string; name: string };
export type XUserLookup = XUser;

type XMediaVariant = {
  bit_rate?: number;
  content_type?: string;
  url: string;
};

type XMedia = {
  media_key: string;
  type: "photo" | "video" | "animated_gif";
  preview_image_url?: string;
  duration_ms?: number;
  public_metrics?: { view_count?: number };
  variants?: XMediaVariant[];
};

type XApiPage = {
  data?: XPost[];
  includes?: { users?: XUser[]; media?: XMedia[] };
  meta?: { next_token?: string };
};

export type XVideoPost = {
  x_post_id: string;
  author_id: string | null;
  author_username: string | null;
  author_name: string | null;
  text: string;
  possibly_sensitive: boolean;
  created_at: string;
  x_url: string;
  media_key: string | null;
  media_type: string | null;
  preview_image_url: string | null;
  video_url: string | null;
  video_bitrate: number | null;
  views: number;
  likes: number;
  reposts: number;
  replies: number;
  quotes: number;
  bookmarks: number;
};

export type XVideoPostSearchResult = {
  posts: XVideoPost[];
  rawPostCount: number;
};

type SearchRecentVideoPostOptions = {
  sinceId?: string | null;
  authorFallback?: XUserLookup;
  includeAuthorExpansion?: boolean;
};

export type XApiUsageSource =
  | "discovery"
  | "priority"
  | "curated_initial"
  | "curated_incremental"
  | "author_lookup"
  | "x_publish";

export async function recordXApiUsage(input: {
  source: XApiUsageSource;
  endpoint: string;
  status: number;
  posts?: number;
  users?: number;
  durationMs: number;
  error?: string;
}) {
  try {
    const { supabaseAdmin } = await import("./supabase-admin");
    await supabaseAdmin().from("x_api_usage_logs").insert({
      source: input.source,
      endpoint: input.endpoint,
      http_status: input.status,
      post_count: input.posts ?? 0,
      user_count: input.users ?? 0,
      duration_ms: input.durationMs,
      error_message: input.error?.slice(0, 500) ?? null,
    });
  } catch {
    // Usage logging must never interrupt collection when the optional table is unavailable.
  }
}

const DEFAULT_QUERY = "動画 has:videos -is:retweet lang:ja";
const DEFAULT_MAX_RESULTS = 100;
const MAX_TOTAL_RESULTS = 200;

const TWEET_FIELDS = [
  "id", "text", "author_id", "created_at", "public_metrics",
  "attachments", "possibly_sensitive"
].join(",");

const MEDIA_FIELDS = [
  "media_key", "type", "preview_image_url", "duration_ms",
  "public_metrics", "variants"
].join(",");

function normalizeTotalResults(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_MAX_RESULTS;
  return Math.max(10, Math.min(Math.floor(value), MAX_TOTAL_RESULTS));
}

function addResponseFields(params: URLSearchParams, includeAuthorExpansion = true) {
  params.set("tweet.fields", TWEET_FIELDS);
  params.set(
    "expansions",
    includeAuthorExpansion ? "author_id,attachments.media_keys" : "attachments.media_keys"
  );
  if (includeAuthorExpansion) params.set("user.fields", "id,username,name");
  else params.delete("user.fields");
  params.set("media.fields", MEDIA_FIELDS);
}

async function fetchXPages(
  endpoint: string,
  params: URLSearchParams,
  totalLimit: number,
  paginationParameter: "next_token" | "pagination_token",
  logLabel: string,
  usageSource: XApiUsageSource
) {
  const token = process.env.X_BEARER_TOKEN;
  if (!token) throw new Error("Missing X_BEARER_TOKEN.");

  const pages: XApiPage[] = [];
  let fetchedCount = 0;
  let nextToken: string | null = null;

  do {
    const remaining = totalLimit - fetchedCount;
    params.set("max_results", String(Math.min(100, Math.max(10, remaining))));
    if (nextToken) params.set(paginationParameter, nextToken);
    else params.delete(paginationParameter);

    const startedAt = Date.now();
    let response: Response;
    try {
      response = await fetch(`${endpoint}?${params.toString()}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store"
      });
    } catch (error) {
      await recordXApiUsage({ source: usageSource, endpoint, status: 0, durationMs: Date.now() - startedAt, error: String(error) });
      throw error;
    }
    if (!response.ok) {
      const body = await response.text();
      await recordXApiUsage({ source: usageSource, endpoint, status: response.status, durationMs: Date.now() - startedAt, error: body });
      throw new Error(`X API ${response.status}: ${body}`);
    }

    const page = (await response.json()) as XApiPage;
    await recordXApiUsage({
      source: usageSource,
      endpoint,
      status: response.status,
      posts: page.data?.length ?? 0,
      users: page.includes?.users?.length ?? 0,
      durationMs: Date.now() - startedAt,
    });
    pages.push(page);
    fetchedCount += page.data?.length ?? 0;
    nextToken = page.meta?.next_token ?? null;
  } while (nextToken && fetchedCount < totalLimit);

  console.log(logLabel, {
    pages: pages.length,
    rawPosts: Math.min(fetchedCount, totalLimit),
    totalLimit
  });
  return pages;
}

function formatVideoPosts(
  pages: XApiPage[],
  rawPostLimit: number,
  fallbackAuthor?: XUser
): XVideoPost[] {
  const usersById = new Map<string, XUser>();
  const mediaByKey = new Map<string, XMedia>();

  for (const page of pages) {
    for (const user of page.includes?.users ?? []) usersById.set(user.id, user);
    for (const media of page.includes?.media ?? []) mediaByKey.set(media.media_key, media);
  }

  return pages
    .flatMap((page) => page.data ?? [])
    .slice(0, rawPostLimit)
    .map((post) => {
      const author = post.author_id ? usersById.get(post.author_id) ?? fallbackAuthor : fallbackAuthor;
      const attachedMedia = (post.attachments?.media_keys ?? [])
        .map((key) => mediaByKey.get(key))
        .filter((item): item is XMedia => Boolean(item));
      const video = attachedMedia.find(
        (item) => item.type === "video" || item.type === "animated_gif"
      );
      const bestMp4 = [...(video?.variants ?? [])]
        .filter((variant) => variant.content_type === "video/mp4")
        .sort((a, b) => (b.bit_rate ?? 0) - (a.bit_rate ?? 0))[0];
      const cleanVideoUrl = bestMp4?.url ? bestMp4.url.split("?")[0] : null;

      return {
        x_post_id: post.id,
        author_id: post.author_id ?? null,
        author_username: author?.username ?? null,
        author_name: author?.name ?? null,
        text: post.text,
        possibly_sensitive: post.possibly_sensitive ?? false,
        created_at: post.created_at ?? new Date().toISOString(),
        x_url: author?.username
          ? `https://x.com/${author.username}/status/${post.id}`
          : `https://x.com/i/web/status/${post.id}`,
        media_key: video?.media_key ?? null,
        media_type: video?.type ?? null,
        preview_image_url: video?.preview_image_url ?? null,
        video_url: cleanVideoUrl,
        video_bitrate: bestMp4?.bit_rate ?? null,
        views: video?.public_metrics?.view_count ?? post.public_metrics?.impression_count ?? 0,
        likes: post.public_metrics?.like_count ?? 0,
        reposts: post.public_metrics?.retweet_count ?? 0,
        replies: post.public_metrics?.reply_count ?? 0,
        quotes: post.public_metrics?.quote_count ?? 0,
        bookmarks: post.public_metrics?.bookmark_count ?? 0
      };
    })
    .filter((post) => post.media_key !== null);
}

export async function lookupXUserByUsername(username: string): Promise<XUserLookup> {
  const token = process.env.X_BEARER_TOKEN;
  if (!token) throw new Error("Missing X_BEARER_TOKEN.");

  const normalized = username.trim().replace(/^@/, "");
  if (!/^[A-Za-z0-9_]{1,15}$/.test(normalized)) {
    throw new Error("Invalid X username.");
  }

  const params = new URLSearchParams({ "user.fields": "id,username,name" });
  const response = await fetch(
    `https://api.x.com/2/users/by/username/${encodeURIComponent(normalized)}?${params.toString()}`,
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
  );
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`X API ${response.status}: ${body}`);
  }

  const payload = await response.json();
  await recordXApiUsage({
    source: "author_lookup",
    endpoint: "users/by/username",
    status: response.status,
    users: payload?.data ? 1 : 0,
    durationMs: 0,
  });
  const user = payload?.data as XUser | undefined;
  if (!user?.id || !user.username) {
    const detail = Array.isArray(payload?.errors)
      ? payload.errors
          .map((item: { detail?: string; title?: string }) => item.detail ?? item.title)
          .filter(Boolean)
          .join(" / ")
      : "";
    throw new Error(detail || "X user was not found.");
  }
  return user;
}

export async function searchRecentVideoPostBatch(
  customQuery?: string,
  requestedMaxResults: number = DEFAULT_MAX_RESULTS,
  options?: SearchRecentVideoPostOptions,
  usageSource: XApiUsageSource = "discovery"
): Promise<XVideoPostSearchResult> {
  const query = customQuery?.trim() || process.env.X_SEARCH_QUERY?.trim() || DEFAULT_QUERY;
  const totalLimit = normalizeTotalResults(requestedMaxResults);
  const params = new URLSearchParams({ query });
  addResponseFields(params, options?.includeAuthorExpansion ?? true);
  if (options?.sinceId && /^\d+$/.test(options.sinceId)) {
    params.set("since_id", options.sinceId);
  }

  const pages = await fetchXPages(
    "https://api.x.com/2/tweets/search/recent",
    params,
    totalLimit,
    "next_token",
    "X SEARCH RESULT",
    usageSource
  );
  const videoPosts = formatVideoPosts(pages, totalLimit, options?.authorFallback);
  const rawPostCount = pages.reduce((sum, page) => sum + (page.data?.length ?? 0), 0);
  console.log("X SEARCH VIDEO RESULT:", { query, rawPostCount, videoPosts: videoPosts.length });
  return { posts: videoPosts, rawPostCount };
}

export async function searchRecentVideoPosts(
  customQuery?: string,
  requestedMaxResults: number = DEFAULT_MAX_RESULTS,
  options?: SearchRecentVideoPostOptions,
  usageSource: XApiUsageSource = "discovery"
) {
  const result = await searchRecentVideoPostBatch(
    customQuery,
    requestedMaxResults,
    options,
    usageSource
  );
  return result.posts;
}

export async function searchAllVideoPostPage(input: {
  query: string;
  maxResults?: number;
  nextToken?: string | null;
  untilId?: string | null;
  authorFallback: XUserLookup;
}) {
  const token = process.env.X_BEARER_TOKEN;
  if (!token) throw new Error("Missing X_BEARER_TOKEN.");

  const endpoint = "https://api.x.com/2/tweets/search/all";
  const maxResults = Math.max(10, Math.min(100, Math.floor(input.maxResults ?? 25)));
  const params = new URLSearchParams({
    query: input.query.trim(),
    max_results: String(maxResults),
  });
  addResponseFields(params, false);
  if (input.nextToken) params.set("next_token", input.nextToken);
  if (input.untilId && /^\d+$/.test(input.untilId)) params.set("until_id", input.untilId);

  const startedAt = Date.now();
  let response: Response;
  try {
    response = await fetch(`${endpoint}?${params.toString()}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
  } catch (error) {
    await recordXApiUsage({
      source: "curated_initial",
      endpoint,
      status: 0,
      durationMs: Date.now() - startedAt,
      error: String(error),
    });
    throw error;
  }

  if (!response.ok) {
    const body = await response.text();
    await recordXApiUsage({
      source: "curated_initial",
      endpoint,
      status: response.status,
      durationMs: Date.now() - startedAt,
      error: body,
    });
    throw new Error(`X API ${response.status}: ${body}`);
  }

  const page = (await response.json()) as XApiPage;
  await recordXApiUsage({
    source: "curated_initial",
    endpoint,
    status: response.status,
    posts: page.data?.length ?? 0,
    users: 0,
    durationMs: Date.now() - startedAt,
  });

  return {
    posts: formatVideoPosts([page], maxResults, input.authorFallback),
    rawPostCount: page.data?.length ?? 0,
    nextToken: page.meta?.next_token ?? null,
  };
}

export async function fetchUserTimelineVideoPosts(
  userId: string,
  requestedMaxPosts: number = MAX_TOTAL_RESULTS,
  usageSource: XApiUsageSource = "curated_initial"
) {
  if (!/^\d+$/.test(userId)) throw new Error("Invalid X user id.");

  const totalLimit = normalizeTotalResults(requestedMaxPosts);
  const params = new URLSearchParams({ exclude: "retweets" });
  addResponseFields(params);
  const pages = await fetchXPages(
    `https://api.x.com/2/users/${userId}/tweets`,
    params,
    totalLimit,
    "pagination_token",
    "X USER TIMELINE RESULT",
    usageSource
  );
  const videoPosts = formatVideoPosts(pages, totalLimit);
  console.log("X USER TIMELINE VIDEO RESULT:", { userId, videoPosts: videoPosts.length });
  return videoPosts;
}
