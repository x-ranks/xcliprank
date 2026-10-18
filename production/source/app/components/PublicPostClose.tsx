"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { safePublicReturn, returnPosition, RETURN_STORAGE_KEY } from "../../lib/public-return-navigation";
export default function PublicPostClose({ returnTo }: { returnTo: string }) {
  const router = useRouter(), target = safePublicReturn(returnTo) ?? "/";
  return <Link href={target} prefetch={false} className="public-post-close" aria-label="動画を閉じて元の一覧へ戻る" title="元の一覧へ戻る" onClick={event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    try { const previous = returnPosition(sessionStorage.getItem(RETURN_STORAGE_KEY)); if (previous && previous.from === target) sessionStorage.setItem(RETURN_STORAGE_KEY, JSON.stringify({ ...previous, restore: true, at: Date.now() })); } catch { /* URL fallback still works. */ }
    router.replace(target, { scroll: false });
  }}><span aria-hidden="true">×</span><span className="public-post-close-text">閉じる</span></Link>;
}
