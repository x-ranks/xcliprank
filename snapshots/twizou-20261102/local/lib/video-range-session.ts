import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
export const RANGE_VIDEO_MAX_BYTES = 32 * 1024 * 1024;
const BLOCK_BYTES = 256 * 1024, CACHE_BYTES = 8 * 1024 * 1024;
export function allowedRangeVideo(url: string) {
  try { const u = new URL(url); return u.protocol === "https:" && !u.username && !u.password && (!u.port || u.port === "443") && (u.hostname === "video.twimg.com" || u.hostname.endsWith(".video.twimg.com")); } catch { return false; }
}
// Private, per-analysis loopback source for FFmpeg. Never a public application
// route. All upstream requests have a finite Range and no credentials/redirects.
export async function createRangeVideoSession(source: string, options: { fetcher?: typeof fetch; maxBytes?: number; timeoutMs?: number } = {}) {
  if (!allowedRangeVideo(source)) throw Error("UNSUPPORTED_VIDEO_URL");
  const max = options.maxBytes ?? RANGE_VIDEO_MAX_BYTES;
  if (!Number.isSafeInteger(max) || max < BLOCK_BYTES || max > 64 * 1024 * 1024) throw Error("VIDEO_RANGE_INVALID_BUDGET");
  const fetcher = options.fetcher ?? fetch, abort = new AbortController();
  let bytes = 0, requests = 0, hits = 0, total = 0, cacheBytes = 0, closed = false, failure: Error | null = null;
  let validator: string | null = null, validatorHeader = "etag", queue = Promise.resolve();
  const cache = new Map<number, Buffer>(), token = "/" + randomBytes(32).toString("hex");
  const timer = setTimeout(() => { failure ??= Error("VIDEO_RANGE_TIMEOUT"); abort.abort(); server.closeAllConnections(); }, options.timeoutMs ?? 90000);
  function fail(error: unknown): never { failure ??= error instanceof Error && /^[A-Z_0-9]+$/.test(error.message) ? error : Error("VIDEO_RANGE_FETCH_FAILED"); abort.abort(); throw failure; }
  async function block(offset: number) {
    const start = Math.floor(offset / BLOCK_BYTES) * BLOCK_BYTES;
    const hit = cache.get(start); if (hit && offset < start + hit.length) { hits++; cache.delete(start); cache.set(start, hit); return { start, data: hit }; }
    if (failure) throw failure;
    const end = total ? Math.min(total - 1, start + BLOCK_BYTES - 1) : start + BLOCK_BYTES - 1;
    if (++requests > 256 || bytes + end - start + 1 > max) return fail(Error("VIDEO_RANGE_BUDGET_EXCEEDED"));
    let response: Response;
    try { response = await fetcher(source, { headers: { Range: `bytes=${start}-${end}`, "Accept-Encoding": "identity", ...(validator ? { "If-Range": validator } : {}) }, redirect: "error", credentials: "omit", cache: "no-store", signal: abort.signal }); }
    catch { return fail(failure ?? Error("VIDEO_RANGE_FETCH_FAILED")); }
    const match = response.headers.get("content-range")?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
    const a = Number(match?.[1]), b = Number(match?.[2]), length = Number(match?.[3]);
    if (response.status !== 206 || !match || a !== start || !Number.isSafeInteger(length) || length <= 0 || b < a || b !== Math.min(end, length - 1) || b >= length || (total && length !== total) || !response.body || (response.headers.get("content-encoding") && response.headers.get("content-encoding") !== "identity")) {
      await response.body?.cancel(); return fail(Error(response.status >= 400 ? `VIDEO_HTTP_${response.status}` : "VIDEO_RANGE_UNAVAILABLE"));
    }
    const contentLength = response.headers.get("content-length");
    if (contentLength !== null && Number(contentLength) !== b - a + 1) { await response.body.cancel(); return fail(Error("VIDEO_RANGE_INVALID_RESPONSE")); }
    const strong = response.headers.get("etag");
    if (!total) { total = length; validator = strong && !strong.startsWith("W/") ? strong : response.headers.get("last-modified"); validatorHeader = strong && !strong.startsWith("W/") ? "etag" : "last-modified"; }
    else if (validator && response.headers.get(validatorHeader) !== validator) { await response.body.cancel(); return fail(Error("VIDEO_RANGE_SOURCE_CHANGED")); }
    const reader = response.body.getReader(), chunks: Buffer[] = []; let size = 0;
    try { for (;;) { const row = await reader.read(); if (row.done) break; bytes += row.value.length; size += row.value.length; if (size > b - a + 1 || bytes > max) return fail(Error("VIDEO_RANGE_BUDGET_EXCEEDED")); chunks.push(Buffer.from(row.value)); } }
    catch (error) { return fail(error); }
    finally { await reader.cancel().catch(() => undefined); }
    if (size !== b - a + 1) return fail(Error("VIDEO_RANGE_TRUNCATED"));
    const data = Buffer.concat(chunks); const old = cache.get(start); if (old) cacheBytes -= old.length;
    cache.set(start, data); cacheBytes += data.length;
    while (cacheBytes > CACHE_BYTES) { const first = cache.keys().next().value!; cacheBytes -= cache.get(first)!.length; cache.delete(first); }
    return { start, data };
  }
  async function handle(req: IncomingMessage, res: ServerResponse) {
    if (closed || req.url !== token || req.socket.remoteAddress !== "127.0.0.1" || req.headers.origin || req.headers.host !== `127.0.0.1:${(server.address() as { port: number })?.port}` || (req.method !== "GET" && req.method !== "HEAD")) { res.writeHead(404); res.end(); return; }
    res.setHeader("Cache-Control", "no-store"); res.setHeader("Content-Type", "video/mp4"); res.setHeader("Accept-Ranges", "bytes");
    if (req.method === "HEAD") { res.setHeader("Content-Length", total); res.end(); return; }
    const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/), start = Number(range?.[1]), end = range?.[2] ? Number(range[2]) : total - 1;
    if (!range || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= total || end < start) { res.writeHead(416, { "Content-Range": `bytes */${total}` }); res.end(); return; }
    try { const part = await block(start), last = Math.min(end, part.start + part.data.length - 1, total - 1); res.writeHead(206, { "Content-Range": `bytes ${start}-${last}/${total}`, "Content-Length": last - start + 1 }); res.end(part.data.subarray(start - part.start, last - part.start + 1)); }
    catch { if (!res.headersSent) res.writeHead(502); res.end(); }
  }
  const server = createServer((req, res) => { queue = queue.then(() => handle(req, res)).catch(() => { res.destroy(); }); });
  try {
    await block(0);
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); }); });
  } catch (error) { clearTimeout(timer); abort.abort(); server.closeAllConnections(); server.close(); cache.clear(); throw error; }
  const address = server.address(); if (!address || typeof address === "string") throw Error("VIDEO_RANGE_LISTEN_FAILED");
  return { url: `http://127.0.0.1:${address.port}${token}`, failure: () => failure,
    metrics: () => ({ mode: "range-frames-v1" as const, receivedBytes: bytes, requests, cacheHits: hits, sourceBytes: total }),
    async close() { if (closed) return; closed = true; clearTimeout(timer); abort.abort(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); cache.clear(); }
  };
}
