import { readPublicIndex } from "../lib/public-video-server";
export const dynamic = "force-dynamic";
import type { MetadataRoute } from "next";
import { SITE_URL } from "../lib/seo";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const posts = await readPublicIndex().catch(() => []);
  return [
    {
      url: SITE_URL,
      changeFrequency: "daily",
      priority: 1
    },
    {
      url: `${SITE_URL}/ranking/daily`,
      changeFrequency: "daily",
      priority: 0.9
    },
    {
      url: `${SITE_URL}/ranking/weekly`,
      changeFrequency: "daily",
      priority: 0.8
    },
    {
      url: `${SITE_URL}/reels`,
      changeFrequency: "daily",
      priority: 0.8
    }
    ,...posts.map(p => ({ url: `${SITE_URL}/p/${p.id}`, ...(p.modifiedAt ? { lastModified: p.modifiedAt } : {}), changeFrequency: "weekly" as const, priority: 0.6 }))
  ];
}
