const MAX_BYTES = 1200;
const MAX_KEYS = 30;
const ACCOUNT_KEY = /^(?:[a-z0-9_]{1,15}|id-[A-Za-z0-9_-]{1,64})$/;

/** Limit a user-submitted follow list without buffering an unbounded request body. */
export async function readFollowKeys(request: Request): Promise<string[]> {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin && origin !== "https://twizou.net") throw Error("INVALID_BODY");
  if (["cross-site", "same-site"].includes(request.headers.get("sec-fetch-site") ?? "")) throw Error("INVALID_BODY");
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) throw Error("INVALID_BODY");
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES)) throw Error("INVALID_BODY");
  const reader = request.body?.getReader();
  if (!reader) throw Error("INVALID_BODY");
  const chunks: Uint8Array[] = []; let total = 0;
  while (true) {
    const part = await reader.read(); if (part.done) break;
    total += part.value.byteLength;
    if (total > MAX_BYTES) { await reader.cancel(); throw Error("INVALID_BODY"); }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let value: unknown; try { value = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw Error("INVALID_BODY"); }
  const keys = (value as { keys?: unknown })?.keys;
  if (!Array.isArray(keys) || keys.length > MAX_KEYS || keys.some(key => typeof key !== "string" || !ACCOUNT_KEY.test(key))) throw Error("INVALID_BODY");
  return keys as string[];
}
