"use client";
import Link from "next/link";
import { useEffect, useState, type ReactNode, type CSSProperties } from "react";
import { publicDetailHref, safePublicReturn, returnPosition, RETURN_STORAGE_KEY } from "../../lib/public-return-navigation";
export default function PublicPostLink({ id, returnTo = "/", children, style, ariaLabel }: { id: string; returnTo?: string; children: ReactNode; style?: CSSProperties; ariaLabel?: string }) {
  const [from, setFrom] = useState(safePublicReturn(returnTo) ?? "/");
  useEffect(() => {
    const u = new URL(window.location.href);
    setFrom(safePublicReturn(u.pathname + u.search) ?? safePublicReturn(u.searchParams.get("from")) ?? safePublicReturn(returnTo) ?? "/");
  }, [returnTo, id]);
  function remember() {
    try {
      const here = new URL(window.location.href), list = safePublicReturn(here.pathname + here.search);
      if (list) sessionStorage.setItem(RETURN_STORAGE_KEY, JSON.stringify({ version: 1, from: list, postId: id, y: window.scrollY, at: Date.now(), restore: false }));
      else { const previous = returnPosition(sessionStorage.getItem(RETURN_STORAGE_KEY)); if (previous && previous.from === from) sessionStorage.setItem(RETURN_STORAGE_KEY, JSON.stringify({ ...previous, at: Date.now() })); }
    } catch { /* Navigation remains usable with storage disabled. */ }
  }
  return <Link href={publicDetailHref(id, from)} prefetch={false} onClick={remember} style={style} aria-label={ariaLabel}>{children}</Link>;
}
