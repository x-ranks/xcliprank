"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { trackEngagement } from "../../lib/engagement-client";
import { outboundXEvent, publicEngagementPath } from "../../lib/engagement-navigation";
import { publicReturnForPost, RETURN_STORAGE_KEY } from "../../lib/public-return-navigation";

export default function EngagementVisitTracker() {
  const pathname = usePathname();
  const previousPath = useRef<string | null>(null);

  useEffect(() => {
    const path = publicEngagementPath(pathname ?? window.location.pathname);
    if (!path) { previousPath.current = null; return; }
    if (previousPath.current === path) return;
    previousPath.current = path;
    trackEngagement({ eventType: "page_view", source: "site_visit", metadata: { path: path.slice(0, 160) } });
  }, [pathname]);

  useEffect(() => {
    function outbound(event: MouseEvent) {
      if (event.defaultPrevented || (event.type === "click" ? event.button !== 0 : event.button !== 1)) return;
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!anchor || anchor.hasAttribute("download")) return;
      let stored: string | null = null;
      try { stored = sessionStorage.getItem(RETURN_STORAGE_KEY); } catch { /* Outbound counting does not require storage. */ }
      const postId = window.location.pathname.match(/^\/p\/([1-9][0-9]{1,24})$/)?.[1];
      const from = publicReturnForPost(postId, null, stored);
      const payload = outboundXEvent(anchor.href, window.location.pathname, window.location.search, from);
      if (payload) trackEngagement(payload);
    }
    // Capture also observes the reels links that stop propagation. Never cancel navigation.
    document.addEventListener("click", outbound, true);
    document.addEventListener("auxclick", outbound, true);
    return () => {
      document.removeEventListener("click", outbound, true);
      document.removeEventListener("auxclick", outbound, true);
    };
  }, []);

  return null;
}
