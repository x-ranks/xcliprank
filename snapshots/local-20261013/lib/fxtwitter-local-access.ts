import type { NextRequest } from "next/server";

export function allowFreeLocalRequest(request: NextRequest, mutation = false): boolean {
  if (process.env.NODE_ENV === "production") return false;
  const loopback = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
  if (!loopback.has(request.nextUrl.hostname)) return false;
  if (!mutation) return true;
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return false;
  const origin = request.headers.get("origin");
  // Next dev may normalize the URL hostname to localhost; compare with the actual Host header.
  const host = request.headers.get("host");
  let actualOrigin = request.nextUrl.origin;
  if (host) {
    try {
      const address = new URL(`${request.nextUrl.protocol}//${host}`);
      if (!loopback.has(address.hostname) || address.username || address.password || address.pathname !== "/") return false;
      actualOrigin = address.origin;
    } catch { return false; }
  }
  if (!origin || origin !== actualOrigin) return false;
  return !["cross-site", "same-site"].includes(request.headers.get("sec-fetch-site") ?? "");
}
