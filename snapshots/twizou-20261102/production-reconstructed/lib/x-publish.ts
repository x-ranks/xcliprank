import { createHmac, randomBytes } from "node:crypto";
import { recordXApiUsage } from "./x";

type XCredentials = {
  consumerKey: string;
  consumerSecret: string;
  accessToken: string;
  accessTokenSecret: string;
};

type XUser = {
  id: string;
  name: string;
  username: string;
};

function credentials(): XCredentials {
  const consumerKey = process.env.X_API_KEY;
  const consumerSecret = process.env.X_API_KEY_SECRET;
  const accessToken = process.env.X_ACCESS_TOKEN;
  const accessTokenSecret = process.env.X_ACCESS_TOKEN_SECRET;

  if (!consumerKey || !consumerSecret || !accessToken || !accessTokenSecret) {
    throw new Error("X投稿用の認証情報が設定されていません。");
  }

  return { consumerKey, consumerSecret, accessToken, accessTokenSecret };
}

function encode(value: string) {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function oauthHeader(method: "GET" | "POST", requestUrl: string) {
  const auth = credentials();
  const url = new URL(requestUrl);
  const oauth: Record<string, string> = {
    oauth_consumer_key: auth.consumerKey,
    oauth_nonce: randomBytes(18).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: auth.accessToken,
    oauth_version: "1.0"
  };

  const signatureParameters = [
    ...Array.from(url.searchParams.entries()),
    ...Object.entries(oauth)
  ]
    .map(([key, value]) => [encode(key), encode(value)] as const)
    .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey === rightKey
        ? leftValue.localeCompare(rightValue)
        : leftKey.localeCompare(rightKey)
    )
    .map(([key, value]) => `${key}=${value}`)
    .join("&");

  const baseUrl = `${url.protocol}//${url.host}${url.pathname}`;
  const signatureBase = [method, encode(baseUrl), encode(signatureParameters)].join("&");
  const signingKey = `${encode(auth.consumerSecret)}&${encode(auth.accessTokenSecret)}`;
  oauth.oauth_signature = createHmac("sha1", signingKey)
    .update(signatureBase)
    .digest("base64");

  return `OAuth ${Object.entries(oauth)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${encode(key)}="${encode(value)}"`)
    .join(", ")}`;
}

export async function uploadXImage(
  bytes: Uint8Array,
  mediaType: "image/jpeg" | "image/png" | "image/webp",
  filename: string
) {
  if (bytes.byteLength === 0 || bytes.byteLength > 5 * 1024 * 1024) {
    throw new Error("Xに添付する画像は5MB以下である必要があります。");
  }

  const url = "https://api.x.com/2/media/upload";
  const startedAt = Date.now();
  const form = new FormData();
  form.append("media", new Blob([new Uint8Array(bytes)], { type: mediaType }), filename);
  form.append("media_category", "tweet_image");
  form.append("media_type", mediaType);

  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: oauthHeader("POST", url) },
    body: form,
    cache: "no-store"
  });
  const payload = await response.json();
  await recordXApiUsage({ source: "x_publish", endpoint: "media/upload", status: response.status, durationMs: Date.now() - startedAt });

  if (!response.ok || typeof payload?.data?.id !== "string") {
    const detail =
      typeof payload?.detail === "string"
        ? payload.detail
        : typeof payload?.title === "string"
          ? payload.title
          : `HTTP ${response.status}`;
    throw new Error(`X画像アップロードエラー: ${detail}`);
  }

  return payload.data.id as string;
}

async function xRequest<T>(
  method: "GET" | "POST",
  url: string,
  body?: unknown
): Promise<T> {
  const startedAt = Date.now();
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: oauthHeader(method, url),
      ...(body === undefined ? {} : { "Content-Type": "application/json" })
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store"
  });
  const payload = await response.json();
  await recordXApiUsage({ source: "x_publish", endpoint: new URL(url).pathname, status: response.status, durationMs: Date.now() - startedAt });

  if (!response.ok) {
    const detail =
      typeof payload?.detail === "string"
        ? payload.detail
        : typeof payload?.title === "string"
          ? payload.title
          : `HTTP ${response.status}`;
    throw new Error(`X APIエラー: ${detail}`);
  }

  return payload as T;
}

export async function verifyXPostingAccount() {
  const payload = await xRequest<{ data: XUser }>(
    "GET",
    "https://api.x.com/2/users/me"
  );
  return payload.data;
}

export async function publishXPost(text: string, mediaIds: string[] = []) {
  const payload = await xRequest<{ data: { id: string; text: string } }>(
    "POST",
    "https://api.x.com/2/tweets",
    {
      text,
      ...(mediaIds.length > 0 ? { media: { media_ids: mediaIds.slice(0, 4) } } : {})
    }
  );
  return payload.data;
}
