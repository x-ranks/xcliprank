export async function boundedJson(request: Request, maximum: number) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw Error("PUBLIC_INVALID_CONTENT_TYPE");
  const reader = request.body?.getReader(); if (!reader) throw Error("PUBLIC_INVALID_INPUT"); const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > maximum) throw Error("PUBLIC_BODY_TOO_LARGE"); chunks.push(value); } } finally { await reader.cancel(); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
