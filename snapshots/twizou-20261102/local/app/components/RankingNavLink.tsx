"use client";
import Link from "next/link";
import { useEffect, useRef, type ComponentProps } from "react";
// Prepare server data on intent. Do not keep a full prefetched page in the
// client Router Cache beyond the server's publication-control lifetime.
export default function RankingNavLink({ href, ...props }: Omit<ComponentProps<typeof Link>, "prefetch">) {
  const key = typeof href === "string" ? href : JSON.stringify(href);
  const recent = useRef({ key: "", at: 0 }), pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), [key]);
  function prepare() {
    if (typeof href !== "string" || recent.current.key === key && Date.now() - recent.current.at < 15000) return;
    const url = new URL(href, "https://twizou.net");
    if (url.origin !== "https://twizou.net") return;
    const range = url.pathname === "/" ? "trending" : url.pathname === "/ranking/daily" ? "daily" : url.pathname === "/ranking/weekly" ? "weekly" : null;
    if (!range) return;
    const query = new URLSearchParams({ range });
    if (range === "trending") query.set("page", url.searchParams.get("page") ?? "1");
    const edition = url.searchParams.get("edition"); if (edition) query.set("edition", edition);
    recent.current = { key, at: Date.now() }; pending.current?.abort();
    const controller = new AbortController(); pending.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 12000);
    void fetch("/api/rankings?" + query, { cache: "no-store", signal: controller.signal })
      .then(response => response.arrayBuffer()).catch(() => {}).finally(() => {
        window.clearTimeout(timeout); if (pending.current === controller) pending.current = null;
      });
  }
  return <Link {...props} href={href} prefetch={false}
    onPointerEnter={event => { if (event.pointerType !== "touch") prepare(); props.onPointerEnter?.(event); }}
    onTouchStart={event => { prepare(); props.onTouchStart?.(event); }}
    onFocus={event => { prepare(); props.onFocus?.(event); }} />;
}
