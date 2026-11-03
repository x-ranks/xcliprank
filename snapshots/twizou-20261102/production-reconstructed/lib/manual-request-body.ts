// Bound the actual stream, including chunked requests with no Content-Length.
export async function readManualRequestBody(request: Request) {
  const maximum = 4 * 1024 * 1024 + 32 * 1024;
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maximum)) throw Error("MANUAL_INPUT_TOO_LARGE");
  if (!request.body) return "";
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > maximum) { await reader.cancel(); throw Error("MANUAL_INPUT_TOO_LARGE"); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString("utf8");
}
