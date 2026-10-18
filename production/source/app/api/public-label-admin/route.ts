import { boundedJson } from "../../../lib/public-http";
import { timingSafeEqual } from "node:crypto";
import { productionPublicBackend } from "../../../lib/public-video-production";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow, noarchive" };
export async function POST(request: Request) {
  const expected = process.env.CRON_SECRET, supplied = request.headers.get("authorization");
  if (!expected || !supplied || Buffer.byteLength(supplied) !== Buffer.byteLength("Bearer " + expected) || !timingSafeEqual(Buffer.from(supplied), Buffer.from("Bearer " + expected))) return Response.json({ ok: false }, { status: 401, headers });
  try {
    const body = await boundedJson(request, 256 * 1024);
    let host: string; try { host = new URL(process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname; } catch { throw Error("PUBLIC_DATABASE_SCOPE_UNKNOWN"); }
    if (typeof body.databaseHost !== "string" || body.databaseHost !== host) return Response.json({ ok: false, error: "PUBLIC_DATABASE_SCOPE_MISMATCH" }, { status: 409, headers });
    const s = productionPublicBackend().service;
    const data = body.action === "status" ? await s.status() : body.action === "inspect" ? await s.inspect(body.ids) : body.action === "candidates" ? await s.candidates(body.excludeIds) : body.action === "publish" ? await s.publish(body.input) : body.action === "auto-page" ? await s.autoPage(body.cursor, body.upper, body.modelRevision) : body.action === "auto-publish" ? await s.autoPublish(body.input) : undefined;
    return data === undefined ? Response.json({ ok: false }, { status: 400, headers }) : Response.json({ ok: true, data }, { headers });
  } catch (e) { const code = e instanceof Error && /^PUBLIC_[A-Z_]+$/.test(e.message) ? e.message : "PUBLIC_REQUEST_FAILED"; return Response.json({ ok: false, error: code }, { status: code.includes("STALE") || code.includes("CHANGED") || code.includes("BUSY") ? 409 : 400, headers }); }
}
