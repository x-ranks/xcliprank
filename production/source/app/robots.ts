import type { MetadataRoute } from "next";
import { SITE_URL } from "../lib/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      // Only the public JSON playback lookup is needed during rendering.
      // Keep other APIs blocked; do not match similarly named routes.
      allow: ["/", "/api/video-playback-url$", "/api/video-playback-url?"],
      disallow: [
        "/api/",
        // Snapshot tokens create a new URL every update; every one canonicalises to the base list.
        // Do NOT add "from=" here: those URLs must stay crawlable so the 301 is seen.
        "/*edition=",
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
