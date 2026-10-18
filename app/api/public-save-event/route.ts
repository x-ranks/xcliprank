export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST() { return Response.json({ ok: false }, { status: 404, headers: { "Cache-Control": "no-store" } }); }
