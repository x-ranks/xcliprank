"use client";

import { useEffect, useRef, useState } from "react";
import { formatVideoDuration } from "../../lib/video-duration-format";

const requests = new Map<string, Promise<number | null>>();
const queue: Array<() => void> = [];
let active = 0;
function pump() {
  while (active < 2 && queue.length) { active++; queue.shift()!(); }
}
function durationFor(url: string): Promise<number | null> {
  const cached = requests.get(url);
  if (cached) return cached;
  const promise = new Promise<number | null>(resolve => {
    queue.push(() => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      fetch(`/api/video?metadata=1&url=${encodeURIComponent(url)}`, { signal: controller.signal })
        .then(async response => response.ok ? (await response.json()).durationSeconds : null)
        .then(value => resolve(typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null))
        .catch(() => resolve(null))
        .finally(() => { clearTimeout(timer); active--; pump(); });
    });
  });
  requests.set(url, promise);
  if (requests.size > 512) requests.delete(requests.keys().next().value!);
  pump();
  return promise;
}

export default function VideoDurationBadge({ url }: { url: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [seconds, setSeconds] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    setSeconds(null);
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      durationFor(url).then(value => { if (alive) setSeconds(value); });
    }, { rootMargin: "0px" });
    observer.observe(node);
    return () => { alive = false; observer.disconnect(); };
  }, [url]);
  const label = formatVideoDuration(seconds);
  return <span ref={ref} className="video-duration-badge"
    style={label ? undefined : { visibility: "hidden" }}
    aria-hidden={!label} aria-label={label ? `再生時間 ${label}` : undefined}>{label}</span>;
}
