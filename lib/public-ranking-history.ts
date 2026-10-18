import { publicPostId } from "./public-video-core";
export async function rememberRanking(response: Response, record: (ids: string[], at: string) => Promise<unknown>) {
  if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) return response;
  try {
    const body = await response.clone().json();
    if (body?.ok === true && ["trending", "daily", "weekly"].includes(body.range) && Array.isArray(body.data) && body.data.length <= 500 && body.data.every((p: any) => publicPostId(p?.x_post_id))) {
      await record([...new Set(body.data.map((p: any) => p.x_post_id as string))] as string[], new Date().toISOString());
    }
  } catch { /* Do not disrupt browsing. Missing history keeps details noindex. */ }
  return response;
}
