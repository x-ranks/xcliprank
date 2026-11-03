"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { safePublicReturn, publicReturnForPost, returnPosition, canUsePublicHistory, RETURN_STORAGE_KEY } from "../../lib/public-return-navigation";
export default function PublicPostClose({ returnTo, postId }: { returnTo?: string; postId?: string }) {
  const router = useRouter(), [target, setTarget] = useState(safePublicReturn(returnTo) ?? "/");
  useEffect(() => {
    let stored: string | null = null;
    try { stored = sessionStorage.getItem(RETURN_STORAGE_KEY); } catch { /* Storage is optional. */ }
    setTarget(publicReturnForPost(postId, returnTo, stored) ?? "/");
  }, [postId, returnTo]);
  return <Link href={target} prefetch={false} className="public-post-close" aria-label="動画を閉じて元の一覧へ戻る" title="元の一覧へ戻る" onClick={event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    let back = false, native = false;
    try {
      const previous = returnPosition(sessionStorage.getItem(RETURN_STORAGE_KEY));
      back = typeof window !== "undefined" && canUsePublicHistory(previous, postId, target, window.history?.length ?? 0,
        typeof document === "undefined" ? "" : document.referrer, window.location.origin);
      native = previous?.navigation === "native";
      if (previous && previous.from === target) sessionStorage.setItem(RETURN_STORAGE_KEY, JSON.stringify({ ...previous, restore: true, at: Date.now() }));
    } catch { /* URL fallback still works. */ }
    if (back) { if (native) window.history.back(); else router.back(); return; }
    if (target.startsWith("/tags/")) window.location.replace(target);
    else router.replace(target, { scroll: false });
  }}><span aria-hidden="true">×</span><span className="public-post-close-text">閉じる</span></Link>;
}
