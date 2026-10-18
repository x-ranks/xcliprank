"use client";
import { useEffect, type Dispatch, type SetStateAction } from "react";
import { safePublicReturn, returnPosition, RETURN_STORAGE_KEY } from "../../lib/public-return-navigation";
export default function PublicListRestore({ ids = "", reveal }: { ids?: string; reveal?: Dispatch<SetStateAction<number>> }) {
  useEffect(() => {
    let a = 0, b = 0;
    try {
      const position = returnPosition(sessionStorage.getItem(RETURN_STORAGE_KEY)), here = safePublicReturn(window.location.pathname + window.location.search);
      if (!position?.restore || position.from !== here || (reveal && !ids)) return;
      if (reveal) { const index = ids.split(",").indexOf(position.postId); if (index >= 0) reveal(n => Math.max(n, index + 1)); }
      a = requestAnimationFrame(() => { b = requestAnimationFrame(() => { window.scrollTo({ top: position.y, behavior: "instant" }); try { sessionStorage.setItem(RETURN_STORAGE_KEY, JSON.stringify({ ...position, restore: false })); } catch { /* Storage is optional. */ } }); });
    } catch { /* A blocked storage API must not prevent list use. */ }
    return () => { cancelAnimationFrame(a); cancelAnimationFrame(b); };
  }, [ids, reveal]);
  return null;
}
