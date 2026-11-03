"use client";
import { useEffect, useState } from "react";
import { readVideoLists, setVideoListEntry } from "../../lib/local-video-lists";

export const VIDEO_LIST_EVENT = "twizou-video-lists-changed";
export default function FavoriteButton({ id }: { id: string }) {
  const [active, setActive] = useState(false), [error, setError] = useState(false);
  useEffect(() => {
    const refresh = () => { try { setActive(readVideoLists(window.localStorage).favorites.includes(id)); } catch { setError(true); } };
    refresh(); window.addEventListener("storage", refresh); window.addEventListener(VIDEO_LIST_EVENT, refresh);
    return () => { window.removeEventListener("storage", refresh); window.removeEventListener(VIDEO_LIST_EVENT, refresh); };
  }, [id]);
  return <span className="favorite-control"><button type="button" aria-pressed={active} aria-label={active ? "お気に入りを解除" : "お気に入りに追加"} onClick={event => {
    event.stopPropagation();
    try { if (!setVideoListEntry(window.localStorage, "favorites", id, !active)) throw Error(); setError(false); window.dispatchEvent(new Event(VIDEO_LIST_EVENT)); }
    catch { setError(true); }
  }}>{active ? "★ お気に入り" : "☆ お気に入り"}</button>{error && <span role="status">登録できませんでした。上限1000件またはブラウザの保存設定をご確認ください。</span>}</span>;
}
