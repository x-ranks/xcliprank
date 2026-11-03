// Read only MP4 metadata through bounded byte ranges; never call the X API.
const MAX_BYTES = 256 * 1024;
const FIRST_BYTES = 64 * 1024;
const MAX_MOOV_BYTES = 128 * 1024;
const cache = new Map<string, { value: number | null; expires: number }>();
const inFlight = new Map<string, Promise<number | null>>();
let activeProbes = 0;

export function isAllowedVideoUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === "https:" && !url.username && !url.password &&
      (!url.port || url.port === "443") &&
      (url.hostname === "video.twimg.com" || url.hostname.endsWith(".video.twimg.com"));
  } catch { return false; }
}

type Box = { type: string; size: number; header: number };
function boxAt(data: Buffer, offset: number, available: number): Box | null {
  if (offset + 8 > data.length) return null;
  let size = data.readUInt32BE(offset);
  const type = data.toString("ascii", offset + 4, offset + 8);
  let header = 8;
  if (size === 1) {
    if (offset + 16 > data.length) return null;
    const big = data.readBigUInt64BE(offset + 8);
    if (big > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    size = Number(big); header = 16;
  } else if (size === 0) size = available;
  return size >= header && size <= available ? { type, size, header } : null;
}

export function parseMovieDuration(data: Buffer): number | null {
  const moov = boxAt(data, 0, Number.MAX_SAFE_INTEGER);
  if (!moov || moov.type !== "moov") return null;
  for (let offset = moov.header; offset + 8 <= Math.min(data.length, moov.size);) {
    const box = boxAt(data, offset, moov.size - offset);
    if (!box) return null;
    if (box.type === "mvhd") {
      const p = offset + box.header;
      const version = data[p];
      if (version !== 0 && version !== 1) return null;
      const scaleOffset = p + (version === 1 ? 20 : 12);
      const durationOffset = scaleOffset + 4;
      const required = durationOffset + (version === 1 ? 8 : 4);
      if (required > data.length || required > offset + box.size) return null;
      const scale = data.readUInt32BE(scaleOffset);
      const duration = version === 1 ? data.readBigUInt64BE(durationOffset)
        : BigInt(data.readUInt32BE(durationOffset));
      if (!scale || !duration || duration === (version === 1 ? 0xffffffffffffffffn : 0xffffffffn)) return null;
      const seconds = Number(duration) / scale;
      return Number.isFinite(seconds) && seconds > 0 && seconds <= 24 * 60 * 60 ? seconds : null;
    }
    offset += box.size;
  }
  return null;
}

export async function readVideoDuration(rawUrl: string, fetcher: typeof fetch = fetch): Promise<number | null> {
  if (!isAllowedVideoUrl(rawUrl)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  let bytes = 0, requests = 0, sourceTotal = 0; let validator: string | null = null, validatorHeader = "etag";
  async function windowAt(offset: number, length: number) {
    if (++requests > 8 || bytes + length > MAX_BYTES) throw new Error("Metadata budget exceeded");
    const response = await fetcher(rawUrl, {
      headers: { Range: `bytes=${offset}-${offset + length - 1}`, "Accept-Encoding": "identity", ...(validator ? { "If-Range": validator } : {}) },
      credentials: "omit", redirect: "error", signal: controller.signal, cache: "no-store",
    });
    const range = response.headers.get("content-range")?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
    const encoding = response.headers.get("content-encoding");
    let total: number;
    if (response.status === 206 && range && Number(range[1]) === offset &&
        Number(range[2]) === Math.min(offset + length - 1, Number(range[3]) - 1) && (!encoding || encoding === "identity")) {
      total = Number(range[3]);
    } else {
      await response.body?.cancel();
      throw new Error("Byte range unavailable");
    }
    if (!Number.isSafeInteger(total) || total <= offset || !response.body) {
      await response.body?.cancel();
      throw new Error("Invalid byte range");
    }
    if (sourceTotal && sourceTotal !== total) { await response.body.cancel(); throw Error("Source changed"); }
    const etag = response.headers.get("etag");
    if (!sourceTotal) { sourceTotal = total; validator = etag && !etag.startsWith("W/") ? etag : response.headers.get("last-modified"); validatorHeader = etag && !etag.startsWith("W/") ? "etag" : "last-modified"; }
    else if (validator && response.headers.get(validatorHeader) !== validator) { await response.body.cancel(); throw Error("Source changed"); }
    const expected = Number(range![2]) - offset + 1;
    if (response.headers.has("content-length") && Number(response.headers.get("content-length")) !== expected) { await response.body.cancel(); throw Error("Invalid length"); }
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let count = 0;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        count += next.value.byteLength;
        if (count > length || bytes + count > MAX_BYTES) throw new Error("Oversized metadata response");
        chunks.push(Buffer.from(next.value));
      }
    } finally { await reader.cancel(); }
    if (count !== expected) throw Error("Truncated metadata");
    bytes += count;
    return { data: Buffer.concat(chunks), total };
  }
  try {
    const first = await windowAt(0, FIRST_BYTES);
    let offset = 0;
    for (let boxes = 0; boxes < 32 && offset + 8 <= first.total; boxes++) {
      const header = offset + 16 <= first.data.length
        ? first.data.subarray(offset) : (await windowAt(offset, Math.min(16, first.total - offset))).data;
      const box = boxAt(header, 0, first.total - offset);
      if (!box) return null;
      if (box.type === "moov") {
        const length = Math.min(box.size, MAX_MOOV_BYTES);
        const data = offset + length <= first.data.length
          ? first.data.subarray(offset, offset + length) : (await windowAt(offset, length)).data;
        return parseMovieDuration(data);
      }
      offset += box.size;
    }
    return null;
  } catch { return null; }
  finally { clearTimeout(timer); }
}

export async function cachedVideoDuration(url: string): Promise<number | null> {
  const hit = cache.get(url);
  if (hit && hit.expires > Date.now()) return hit.value;
  const pending = inFlight.get(url);
  if (pending) return pending;
  if (activeProbes >= 4) return null;
  activeProbes++;
  const promise = readVideoDuration(url).then(value => {
    cache.delete(url);
    cache.set(url, { value, expires: Date.now() + (value === null ? 5 * 60_000 : 6 * 60 * 60_000) });
    if (cache.size > 512) cache.delete(cache.keys().next().value!);
    return value;
  }).finally(() => { activeProbes--; inFlight.delete(url); });
  inFlight.set(url, promise);
  return promise;
}
