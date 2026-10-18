// Local-management bridge. Production installer replaces ONLY this new file with
// the reviewed production adapter; the local source is never a production build.
import { cache } from "react";
import { createPublicVideoService } from "./public-video-service";
type Backend = ReturnType<typeof createPublicVideoService>;
const endpoint = "https://xcliprank.com/api/public-video";
async function request<T>(type: string, value = ""): Promise<T> {
  const url = new URL(endpoint); url.searchParams.set("type", type); url.searchParams.set("value", value);
  const r = await fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15000) });
  if (!r.ok || !r.headers.get("content-type")?.includes("application/json")) throw Error("PUBLIC_PRODUCTION_UPDATE_REQUIRED");
  const body = await r.json(); if (!body.ok) throw Error("PUBLIC_READ_FAILED"); return body.data as T;
}
export const readPublicDetail = cache((id: string) => request<Awaited<ReturnType<Backend["detail"]>>>("detail", id));
export const readPublicAccount = cache((key: string) => request<Awaited<ReturnType<Backend["account"]>>>("account", key));
export const readPublicTag = cache((name: string) => request<Awaited<ReturnType<Backend["tag"]>>>("tag", name));
export const readPublicIndex = cache(() => request<Awaited<ReturnType<Backend["indexable"]>>>("sitemap"));
