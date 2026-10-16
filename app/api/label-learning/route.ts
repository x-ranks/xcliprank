import { allowLabelRequest, labelError, labelHeaders } from "../../../lib/label-learning-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function GET(request: Request) {
  if (!allowLabelRequest(request)) return new Response(null, { status: 404, headers: labelHeaders });
  try { return Response.json(await (await import("../../../lib/label-learning-server")).labelService.status(), { headers: labelHeaders }); }
  catch (e) { return Response.json(labelError(e), { status: 500, headers: labelHeaders }); }
}
export async function POST(request: Request) {
  if (!allowLabelRequest(request)) return new Response(null, { status: 404, headers: labelHeaders });
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return new Response(null, { status: 415, headers: labelHeaders });
  try {
    const reader = request.body?.getReader(); if (!reader) throw Error("LABEL_INVALID_INPUT");
    const chunks: Uint8Array[] = []; let length = 0;
    try { while (true) { const { value, done } = await reader.read(); if (done) break; length += value.length; if (length > 32768) throw Error("LABEL_INVALID_INPUT"); chunks.push(value); } } finally { await reader.cancel(); }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw Error("LABEL_INVALID_INPUT");
    const result = await (await import("../../../lib/label-learning-server")).labelService.mutate(body);
    return Response.json(result, { headers: labelHeaders });
  } catch (e) { return Response.json(labelError(e), { status: 400, headers: labelHeaders }); }
}
