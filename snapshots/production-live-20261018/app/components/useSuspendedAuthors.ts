"use client";
import { useEffect, useState } from "react";
const EMPTY: string[] = [];
export default function useSuspendedAuthors() {
  const [keys, setKeys] = useState<string[]>(EMPTY);
  useEffect(() => {
    const controller = new AbortController(); let pending = false;
    const refresh = async () => {
      if (document.hidden || pending || controller.signal.aborted) return;
      pending = true;
      try {
        const response = await fetch("/api/rankings?range=author-status", { cache: "no-store", signal: controller.signal });
        const body = await response.json();
        if (!response.ok || body.ok !== true || !Array.isArray(body.blockedKeys) || body.blockedKeys.length > 55000 ||
            body.blockedKeys.some((key: unknown) => typeof key !== "string" || !/^(?:id:\d{2,20}|name:[a-z0-9_]{1,15}|post:\d{2,20})$/.test(key))) return;
        if (!controller.signal.aborted) setKeys(current => {
          const next = [...new Set<string>(body.blockedKeys)].sort();
          return next.join("|") === current.join("|") ? current : next;
        });
      } catch { /* Retain the last confirmed state on a temporary fetch failure. */ }
      finally { pending = false; }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15 * 60000);
    const visible = () => void refresh(); document.addEventListener("visibilitychange", visible);
    return () => { controller.abort(); window.clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, []);
  return keys;
}
