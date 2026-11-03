"use client";

import { useEffect, useRef, useState } from "react";
import { formatVideoDuration } from "../../lib/video-duration-format";
import { readPostVideoDuration } from "../../lib/browser-direct-playback";

type Entry = {
  promise: Promise<number | null>;
  resolve: (value: number | null) => void;
  controller: AbortController;
  consumers: number;
  started: boolean;
  settled: boolean;
  until: number;
};
const requests = new Map<string, Entry>();
const queue: Array<() => void> = [];
let active = 0;
function pump() {
  while (active < 2 && queue.length) { active++; queue.shift()!(); }
}
function acquireDuration(postId: string) {
  let entry = requests.get(postId);
  if (!entry || (entry.settled && entry.until <= Date.now())) {
    let resolve!: Entry["resolve"];
    const promise = new Promise<number | null>(done => { resolve = done; });
    entry = { promise, resolve, controller: new AbortController(), consumers: 0,
      started: false, settled: false, until: 0 };
    const job = entry;
    requests.set(postId, job);
    queue.push(() => {
      if (job.controller.signal.aborted) { active--; pump(); return; }
      job.started = true;
      const timer = setTimeout(() => job.controller.abort(), 15000);
      void readPostVideoDuration(postId, job.controller.signal).then(value => {
        job.settled = true;
        job.until = Date.now() + (value === null ? 60000 : 600000);
        job.resolve(value);
      }).finally(() => {
        clearTimeout(timer);
        if (job.controller.signal.aborted && requests.get(postId) === job) requests.delete(postId);
        // Evict settled entries only; never duplicate an in-flight request.
        if (requests.size > 512) {
          for (const [id, cached] of requests) {
            if (cached.settled && cached.consumers === 0) requests.delete(id);
            if (requests.size <= 512) break;
          }
        }
        active--; pump();
      });
    });
  }
  const current = entry;
  current.consumers++;
  pump();
  let released = false;
  return {
    promise: current.promise,
    release() {
      if (released) return;
      released = true;
      current.consumers--;
      if (current.consumers === 0 && !current.settled) {
        current.controller.abort();
        if (!current.started) { current.settled = true; current.resolve(null); }
        if (requests.get(postId) === current) requests.delete(postId);
      }
    },
  };
}

export default function VideoDurationBadge({ postId }: { postId: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [result, setResult] = useState<{ id: string; seconds: number | null } | null>(null);
  useEffect(() => {
    let alive = true;
    let lease: ReturnType<typeof acquireDuration> | undefined;
    const node = ref.current;
    if (!node) return;
    const load = () => {
      if (lease) return;
      lease = acquireDuration(postId);
      lease.promise.then(seconds => { if (alive) setResult({ id: postId, seconds }); });
    };
    let observer: IntersectionObserver | undefined;
    if (typeof IntersectionObserver === "undefined") load();
    else {
      observer = new IntersectionObserver(entries => {
        if (!entries.some(entry => entry.isIntersecting)) return;
        observer?.disconnect(); load();
      }, { rootMargin: "0px" });
      observer.observe(node);
    }
    return () => { alive = false; observer?.disconnect(); lease?.release(); };
  }, [postId]);
  const label = formatVideoDuration(result?.id === postId ? result.seconds : null);
  return <span ref={ref} className="video-duration-badge"
    style={label ? undefined : { visibility: "hidden" }}
    aria-hidden={!label} aria-label={label ? `再生時間 ${label}` : undefined}>{label}</span>;
}
