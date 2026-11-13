import { readVapidConfig } from "../../../lib/web-push";
import { parseEndpoint, subscribe } from "../../../lib/push-service";
import { readPushBody } from "../../../lib/push-request";
import { supabasePushStore } from "../../../lib/push-store";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" };
/** GET: the public VAPID key the browser needs to subscribe. 503 when notifications are not set up yet. */
export async function GET() {
  const vapid = readVapidConfig();
  return vapid ? Response.json({ ok: true, key: vapid.publicKey }, { headers }) : Response.json({ ok: false }, { status: 503, headers });
}
/** POST: save or refresh a subscription with the followed account keys. */
export async function POST(request: Request) {
  let body: unknown; try { body = await readPushBody(request); } catch { return Response.json({ ok: false }, { status: 400, headers }); }
  if (!readVapidConfig()) return Response.json({ ok: false }, { status: 503, headers });
  try {
    const result = await subscribe(supabasePushStore(), body);
    return Response.json({ ok: result === "ok" }, { status: result === "ok" ? 200 : result === "full" ? 503 : 400, headers });
  } catch { return Response.json({ ok: false }, { status: 503, headers }); }
}
/** DELETE: forget a subscription. */
export async function DELETE(request: Request) {
  let endpoint: string | null; try { endpoint = parseEndpoint(await readPushBody(request)); } catch { return Response.json({ ok: false }, { status: 400, headers }); }
  if (!endpoint) return Response.json({ ok: false }, { status: 400, headers });
  try { await supabasePushStore().remove(endpoint); return Response.json({ ok: true }, { headers }); } catch { return Response.json({ ok: false }, { status: 503, headers }); }
}
