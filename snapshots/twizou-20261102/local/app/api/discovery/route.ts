// Local management preview reads public, permission-checked data from production.
import { readDiscoveryIds } from "../../../lib/discovery-request";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" };
export async function GET(request: Request) {
  const input = new URL(request.url), url = new URL("https://twizou.net/api/discovery");
  url.search = input.search;
  try { const response = await fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15000) }); return new Response(await response.text(), { status: response.status, headers: { ...headers, "Content-Type": "application/json" } }); }
  catch { return Response.json({ ok: false }, { status: 503, headers }); }
}
export async function POST(request: Request) {
  let ids: string[]; try { ids = await readDiscoveryIds(request); } catch { return Response.json({ ok: false }, { status: 400, headers }); }
  try {
    const response = await fetch("https://twizou.net/api/discovery", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15000) });
    return new Response(await response.text(), { status: response.status, headers: { ...headers, "Content-Type": "application/json" } });
  } catch { return Response.json({ ok: false }, { status: 503, headers }); }
}
