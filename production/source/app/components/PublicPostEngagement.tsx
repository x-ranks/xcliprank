"use client";

import { useEffect, useRef } from "react";
import { createEngagementEventId, trackEngagement } from "../../lib/engagement-client";
import { publicReturnForPost, RETURN_STORAGE_KEY } from "../../lib/public-return-navigation";
import { recordRecent } from "../../lib/recent-videos";

function rankingRange(sourcePage: string | null) {
  if (!sourcePage) return undefined;
  const path = sourcePage.split("?")[0];
  if (path === "/") return "trending";
  if (path === "/ranking/daily") return "daily";
  if (path === "/ranking/weekly") return "weekly";
  if (path === "/rising") return "rising";
  if (path === "/reels") return "reels";
  if (path === "/discover") return "discover";
  if (path === "/favorites") return "favorites";
  if (path === "/following") return "following";
  if (path === "/browse") return "browse";
  if (path === "/accounts" || path.startsWith("/accounts/")) return "accounts";
  if (path === "/tags" || path.startsWith("/tags/")) return "tags";
  return undefined;
}

export default function PublicPostEngagement({ postId, sourcePage }: { postId: string; sourcePage: string | null }) {
  const openId = useRef<{ postId: string; id: string } | null>(null);
  useEffect(() => {
    if (!openId.current || openId.current.postId !== postId) openId.current = { postId, id: createEngagementEventId() };
    let stored: string | null = null;
    try { stored = sessionStorage.getItem(RETURN_STORAGE_KEY); } catch { /* Tracking does not require storage. */ }
    const from = publicReturnForPost(postId, sourcePage, stored);
    trackEngagement({
      eventType: "video_open",
      occurrenceId: openId.current.id,
      xPostId: postId,
      range: rankingRange(from) ?? "landing",
      source: "post_detail",
    });
  }, [postId, sourcePage]);

  // Remember this video for the "最近見た" tab; storage is optional.
  useEffect(() => { try { recordRecent(localStorage, postId); } catch { /* ignore */ } }, [postId]);

  return null;
}
