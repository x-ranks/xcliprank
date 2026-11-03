import type { NextRequest } from "next/server";

export function isCronAuthorized(request: NextRequest) {
  // Local-only management screens do not require the production cron secret.
  // Requests to deployed hosts continue to require the secret below.
  if (
    process.env.NODE_ENV !== "production" &&
    ["localhost", "127.0.0.1", "::1"].includes(request.nextUrl.hostname)
  ) {
    return true;
  }

  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}` ||
    request.nextUrl.searchParams.get("secret") === secret;
}
