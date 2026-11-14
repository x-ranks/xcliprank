import { publicPostId } from "./public-video-core";
type DayRecorder = (range: "daily" | "weekly", ids: string[], at: string) => Promise<unknown>;
// history: only for the current ranking (never an explicitly requested old edition or a later page).
export async function rememberRanking(response: Response, record: (ids: string[], at: string) => Promise<unknown>, history?: DayRecorder | null) {
  if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) return response;
  try {
    const body = await response.clone().json();
    if (body?.ok === true && ["trending", "daily", "weekly"].includes(body.range) && Array.isArray(body.data) && body.data.length <= 500) {
      const ids: string[] = body.data.map((p: any) => p?.x_post_id).filter((id: unknown): id is string => publicPostId(id));
      const at = new Date().toISOString();
      if (ids.length) await record([...new Set(ids)], at);
      // Manual entries without an X post are skipped; the order of the remaining posts is the ranking order.
      if (history && ids.length && (body.range === "daily" || body.range === "weekly")) { try { await history(body.range, ids, at); } catch { /* optional */ } }
    }
  } catch { /* Do not disrupt browsing. Missing history keeps details noindex. */ }
  return response;
}
