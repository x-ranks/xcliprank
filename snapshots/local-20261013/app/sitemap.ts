import type { MetadataRoute } from "next";
import { SITE_URL } from "../lib/seo";

export default function sitemap(): MetadataRoute.Sitemap {
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
  ];
}
