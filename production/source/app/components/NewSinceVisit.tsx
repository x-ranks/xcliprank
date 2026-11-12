"use client";

import { useEffect, useState } from "react";
import { BASELINE_KEY, LAST_SEEN_KEY, nextBaseline, newestId, newSinceVisit, sinceLabel, type NewSince } from "../../lib/new-since-visit";

/** Tells a returning visitor how many videos are new since the last visit and outlines them. */
export default function NewSinceVisit({ ids }: { ids: string[] }) {
  const [info, setInfo] = useState<NewSince | null>(null);
  useEffect(() => {
    if (!ids.length) return;
    try {
      const now = Date.now();
      let previous: { top?: unknown; at?: unknown } | null = null;
      try { previous = JSON.parse(localStorage.getItem(LAST_SEEN_KEY) || "null"); } catch { previous = null; }
      // The visit's reference point is fixed once per visit (per tab), so the newest list, rankings and
      // rising all compare against the same moment instead of the previous page load.
      let session: unknown = null;
      try { session = JSON.parse(sessionStorage.getItem(BASELINE_KEY) || "null"); } catch { session = null; }
      const baseline = nextBaseline(session, previous, now);
      try { sessionStorage.setItem(BASELINE_KEY, JSON.stringify(baseline)); } catch { /* optional */ }
      const shown = newSinceVisit(ids, baseline.top, baseline.at, now);
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
