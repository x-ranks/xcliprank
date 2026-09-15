import type { MetadataRoute } from "next";
import { SITE_URL } from "../lib/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/curated-authors",
        "/learning-tools",
        "/preference-model",
        "/review",
        "/teacher-authors",
        "/removal-requests-admin",
        "/ranking-admin",
        "/content-filter-review",
        "/combined-ranking-preview",
        "/visual-filter-preview",
        "/visual-reference-review",
        "/site-visual-preference-review",
        "/x-promotion",
        "/x-api-usage"
      ]
    },
    sitemap: `${SITE_URL}/sitemap.xml`
  };
}
