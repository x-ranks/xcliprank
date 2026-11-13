const MAX_BYTES = 2500;
/** Same-origin JSON body with a hard size limit (the push subscription plus up to 30 account keys). */
export async function readPushBody(request: Request): Promise<unknown> {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin && origin !== "https://twizou.net") throw Error("INVALID_BODY");
  if (["cross-site", "same-site"].includes(request.headers.get("sec-fetch-site") ?? "")) throw Error("INVALID_BODY");
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) throw Error("INVALID_BODY");
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES)) throw Error("INVALID_BODY");
  const reader = request.body?.getReader(); if (!reader) throw Error("INVALID_BODY");
  const chunks: Uint8Array[] = []; let total = 0;
  while (true) {
    const part = await reader.read(); if (part.done) break;
    total += part.value.byteLength; if (total > MAX_BYTES) { await reader.cancel(); throw Error("INVALID_BODY"); }
    chunks.push(part.value);
  }
  try { return JSON.parse(new TextDecoder().decode(Buffer.concat(chunks))); } catch { throw Error("INVALID_BODY"); }
}
