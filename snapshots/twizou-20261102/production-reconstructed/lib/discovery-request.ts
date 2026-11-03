/** Limit user-submitted ID lists without buffering an unbounded request body. */
export async function readDiscoveryIds(request: Request): Promise<string[]> {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin && origin !== "https://twizou.net") throw Error("INVALID_BODY");
  if (["cross-site", "same-site"].includes(request.headers.get("sec-fetch-site") ?? "")) throw Error("INVALID_BODY");
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) throw Error("INVALID_BODY");
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > 1600)) throw Error("INVALID_BODY");
  const reader = request.body?.getReader();
  if (!reader) throw Error("INVALID_BODY");
  const chunks: Uint8Array[] = []; let total = 0;
  while (true) {
    const part = await reader.read(); if (part.done) break;
    total += part.value.byteLength;
    if (total > 1600) { await reader.cancel(); throw Error("INVALID_BODY"); }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let value: unknown; try { value = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw Error("INVALID_BODY"); }
  const ids = (value as { ids?: unknown })?.ids;
  if (!Array.isArray(ids) || ids.length > 50 || ids.some(id => typeof id !== "string" || !/^[1-9][0-9]{1,24}$/.test(id))) throw Error("INVALID_BODY");
  return ids as string[];
}
