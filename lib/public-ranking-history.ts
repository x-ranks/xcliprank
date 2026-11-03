import { publicPostId } from "./public-video-core";
export async function rememberRanking(response: Response, record: (ids: string[], at: string) => Promise<unknown>) {
  if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) return response;
  try {
    const body = await response.clone().json();
    if (body?.ok === true && ["trending", "daily", "weekly"].includes(body.range) && Array.isArray(body.data) && body.data.length <= 500) {
      const ids: string[] = body.data.map((p: any) => p?.x_post_id).filter((id: unknown): id is string => publicPostId(id));
      if (ids.length) await record([...new Set(ids)], new Date().toISOString());
    }
  } catch { /* Do not disrupt browsing. Missing history keeps details noindex. */ }
  return response;
}
