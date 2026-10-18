import { randomInt } from "node:crypto";
// Low-volume background policy. Jitter spreads load; it does not bypass provider limits.
export const HOUR = 3600000;
export const DAY = 24 * HOUR;
export const BATCH_INTERVAL = 3 * HOUR;
export const AUTHOR_BATCH_LIMIT = 12;
export const POST_BATCH_LIMIT = 20;
export const REQUEST_SPACING = 5000;
export const MONITOR_REQUEST_MIN_MS = 8000;
export const MONITOR_REQUEST_MAX_MS = 20000;
export const monitorRequestDelayMs = () => randomInt(MONITOR_REQUEST_MIN_MS, MONITOR_REQUEST_MAX_MS + 1);
export const pauseMonitorRequest = () => new Promise<void>(resolve => setTimeout(resolve, monitorRequestDelayMs()));
export const FAILURE_COOLDOWN = 6 * HOUR;
export type MonitorReply = { http: number; body?: any; limited?: boolean; retryAfterMs?: number; failed?: boolean };
export async function fetchMonitorJson(endpoint: string, fetcher: typeof fetch = fetch): Promise<MonitorReply> {
  if (!/^\/(?:2\/profile\/(?:id%3A\d{2,20}|[a-z0-9_]{1,15})|2\/status\/\d{2,20})$/.test(endpoint)) throw Error("MONITOR_INVALID_ENDPOINT");
  try {
    const response = await fetcher("https://api.fxtwitter.com" + endpoint, {
      cache: "no-store", redirect: "error", credentials: "omit", referrerPolicy: "no-referrer",
      headers: { "User-Agent": "Xclip-Availability-Monitor/2.0 (+https://xcliprank.com)", Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    const retry = response.headers.get("retry-after");
    const retryMs = retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : retry ? Date.parse(retry) - Date.now() : 0;
    const retryAfterMs = Number.isFinite(retryMs) ? Math.min(7 * DAY, Math.max(FAILURE_COOLDOWN, retryMs)) : FAILURE_COOLDOWN;
    if (response.status === 429) { await response.body?.cancel(); return { http: 429, limited: true, retryAfterMs }; }
    if (![200, 401, 403, 404].includes(response.status) || !response.headers.get("content-type")?.toLowerCase().includes("application/json") ||
        Number(response.headers.get("content-length")) > 1024 * 1024) {
      await response.body?.cancel(); return { http: response.status, failed: true };
    }
    const reader = response.body?.getReader(); if (!reader) return { http: response.status, failed: true };
    const chunks: Uint8Array[] = []; let size = 0;
    try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength;
      if (size > 1024 * 1024) { await reader.cancel(); return { http: response.status, failed: true }; } chunks.push(part.value); } }
    finally { reader.releaseLock(); }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (body?.code === 429) return { http: response.status, limited: true, retryAfterMs };
    return { http: response.status, body, failed: ![200, 401, 403, 404].includes(body?.code) };
  } catch { return { http: 0, failed: true }; }
}
