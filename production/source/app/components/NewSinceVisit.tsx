"use client";

import { useEffect, useState } from "react";
import { LAST_SEEN_KEY, SESSION_BANNER_KEY, newestId, newSinceVisit, sinceLabel, type NewSince } from "../../lib/new-since-visit";

/** Tells a returning visitor how many videos are new since the last visit and outlines them. */
export default function NewSinceVisit({ ids }: { ids: string[] }) {
  const [info, setInfo] = useState<NewSince | null>(null);
  useEffect(() => {
    if (!ids.length) return;
    try {
      const now = Date.now();
      let shown: NewSince | null = null;
      let previous: { top?: unknown; at?: unknown } | null = null;
      try { previous = JSON.parse(localStorage.getItem(LAST_SEEN_KEY) || "null"); } catch { previous = null; }
      // Keep the banner while the visitor browses back to the list within the same tab session.
      try {
        const cached = JSON.parse(sessionStorage.getItem(SESSION_BANNER_KEY) || "null");
        if (cached && cached.top === ids[0] && Array.isArray(cached.indexes) && Number.isFinite(cached.count) && Number.isFinite(cached.sinceMs)) {
          shown = { count: cached.count, indexes: cached.indexes.filter((n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) < ids.length), sinceMs: cached.sinceMs };
        }
      } catch { /* A broken cache only means recomputing. */ }
      if (!shown) {
        shown = newSinceVisit(ids, previous?.top, previous?.at, now);
        if (shown) { try { sessionStorage.setItem(SESSION_BANNER_KEY, JSON.stringify({ ...shown, top: ids[0] })); } catch { /* optional */ } }
      }
      const top = newestId(ids, previous?.top);
      if (top) localStorage.setItem(LAST_SEEN_KEY, JSON.stringify({ top, at: now }));
      setInfo(shown && shown.indexes.length ? shown : null);
    } catch { /* Personalisation must never break the list. */ }
  }, [ids]);

  if (!info) return null;
  const selector = info.indexes.slice(0, 50).map(index => `.video-grid>.video-card:nth-child(${index + 1})`).join(",");
  return <>
    <style dangerouslySetInnerHTML={{ __html: `${selector}{border-color:#ff3347!important;box-shadow:0 0 0 1px #ff3347,0 4px 18px #0002}` }} />
    <p className="new-since-visit" role="status">前回の訪問（{sinceLabel(info.sinceMs)}）から<strong>新着{info.count}件</strong>。赤い枠の動画が新しく追加されました。</p>
  </>;
}
