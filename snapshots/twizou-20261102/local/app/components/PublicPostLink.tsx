"use client";
import Link from "next/link";
import { requestPublicDetail } from "../../lib/public-detail-navigation";
import { useEffect, useState, type ReactNode, type CSSProperties, type MouseEvent } from "react";
import { publicDetailHref, safePublicReturn, publicReturnForPost, returnPosition, rememberPublicHistory, RETURN_STORAGE_KEY } from "../../lib/public-return-navigation";
export default function PublicPostLink({ id, returnTo = "/", children, style, ariaLabel, nativeNavigation = false }: { id: string; returnTo?: string; children: ReactNode; style?: CSSProperties; ariaLabel?: string; nativeNavigation?: boolean }) {
  const [pending, setPending] = useState(false);
  useEffect(() => { const reset = () => setPending(false); window.addEventListener("pageshow", reset); return () => window.removeEventListener("pageshow", reset); }, []);
  function remember(event?: MouseEvent<HTMLAnchorElement>) {
    try {
      const here = new URL(window.location.href), list = safePublicReturn(here.pathname + here.search);
      const stored = sessionStorage.getItem(RETURN_STORAGE_KEY), previous = returnPosition(stored);
      const currentId = here.pathname.match(/^\/p\/([1-9][0-9]{1,24})$/)?.[1];
      const from = list ?? publicReturnForPost(currentId, here.searchParams.get("from"), stored) ?? safePublicReturn(returnTo) ?? "/";
      const sameTab = !event || event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
      const position = { version: 1 as const, from, postId: id,
        y: list ? window.scrollY : previous?.from === from ? previous.y : 0, at: Date.now(), restore: false,
        ...(list ? { historyLength: window.history?.length ?? 0, navigation: nativeNavigation || !sameTab ? "native" as const : "client" as const } : {}) };
      rememberPublicHistory(sameTab ? position : null);
      sessionStorage.setItem(RETURN_STORAGE_KEY, JSON.stringify(position));
    } catch { /* A clean detail URL and the default close link still work without storage. */ }
  }
  function open(event: MouseEvent<HTMLAnchorElement>) {
    remember(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (requestPublicDetail(id)) { event.preventDefault(); return; }
    setPending(true);
  }
  const href = publicDetailHref(id);
  const content = <>{children}{pending ? <span role="status" style={{ position: "absolute", top: 8, left: 8, zIndex: 3, padding: "6px 10px", borderRadius: 8, background: "#111e", color: "#fff", fontSize: 13 }}>動画を開いています…</span> : null}</>;
  const linkStyle = { position: "relative" as const, WebkitTapHighlightColor: "transparent", ...style };
  if (nativeNavigation) return <a href={href} onClick={open} style={linkStyle} aria-label={ariaLabel} aria-busy={pending || undefined}>{content}</a>;
  return <Link href={href} prefetch={false} onClick={open} style={linkStyle} aria-label={ariaLabel} aria-busy={pending || undefined}>{content}</Link>;
}
