"use client";

import { useEffect } from "react";
import { trackEngagement } from "../../lib/engagement-client";

const PUBLIC_PATHS = new Set([
  "/",
  "/ranking/daily",
  "/ranking/weekly",
  "/reels",
]);

export default function EngagementVisitTracker() {
  useEffect(() => {
    const path = window.location.pathname;
    if (!PUBLIC_PATHS.has(path)) return;

    trackEngagement({
      eventType: "page_view",
      source: "site_visit",
      metadata: { path: path.slice(0, 160) },
    });
  }, []);

  return null;
}
