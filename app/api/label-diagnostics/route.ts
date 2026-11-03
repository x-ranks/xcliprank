import { allowLabelRequest, labelError, labelHeaders } from "../../../lib/label-learning-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  if (!allowLabelRequest(request)) return new Response(null, { status: 404, headers: labelHeaders });
  try { return Response.json(await (await import("../../../lib/label-a4-server")).readLabelA4Diagnostics(), { headers: labelHeaders }); }
  catch (error) { return Response.json(labelError(error), { status: 400, headers: labelHeaders }); }
}
