import { allowLabelRequest, labelHeaders } from "../../../../lib/label-learning-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  if (!allowLabelRequest(request)) return new Response(null, { status: 404, headers: labelHeaders });
  const url = new URL(request.url), index = url.searchParams.get("index");
  if (!/^[0-3]$/.test(index ?? "")) return new Response(null, { status: 400, headers: labelHeaders });
  try {
    const bytes = await (await import("../../../../lib/label-learning-server")).labelService.frame(url.searchParams.get("postId") ?? "", Number(index));
    return new Response(new Uint8Array(bytes), { headers: { ...labelHeaders, "Content-Type": "image/jpeg", "X-Content-Type-Options": "nosniff" } });
  } catch { return new Response(null, { status: 404, headers: labelHeaders }); }
}
