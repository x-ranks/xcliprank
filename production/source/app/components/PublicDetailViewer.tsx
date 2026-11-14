"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import SiteBrand from "./SiteBrand";
import DirectPlaybackVideo from "./DirectPlaybackVideo";
import PostActionBar from "./PostActionBar";
import FollowButton from "./FollowButton";
import PublicPostText from "./PublicPostText";
import PublicPostEngagement from "./PublicPostEngagement";
import PublicVideoCards from "./PublicVideoCards";
import { accountKey, authorHref, publicVideoFacts, publicRankFacts, tagHref } from "../../lib/public-video-core";
import { safePublicReturn } from "../../lib/public-return-navigation";
import { PUBLIC_DETAIL_OPEN_EVENT } from "../../lib/public-detail-navigation";
import type { createPublicVideoService } from "../../lib/public-video-service";
type Service = ReturnType<typeof createPublicVideoService>;
type Detail = NonNullable<Awaited<ReturnType<Service["detailCore"]>>>;
type Related = Awaited<ReturnType<Service["detailRelated"]>>;
type View = { id: string; from: string; phase: "loading" | "ready" | "missing" | "failed"; detail?: Detail; related?: Related };
type Active = { id: string; from: string; path: string; abort: AbortController; title: string; canonical: string | null; overflow: string };
async function readJson(path: string, signal: AbortSignal) {
  const response = await fetch(path, { signal, cache: "no-store", credentials: "same-origin" });
  if (!response.ok) throw Error("PUBLIC_DETAIL_UNAVAILABLE");
  const text = await response.text(); if (text.length > 512 * 1024) throw Error("PUBLIC_DETAIL_LIMIT");
  const result = JSON.parse(text); if (result.ok !== true) throw Error("PUBLIC_DETAIL_UNAVAILABLE");
  return result.data;
}
export default function PublicDetailViewer() {
  const pathname = usePathname(), [view, setView] = useState<View | null>(null), active = useRef<Active | null>(null), dialog = useRef<HTMLDialogElement | null>(null);
  function release() {
    const current = active.current; active.current = null;
    if (!current) return;
    current.abort.abort(); document.body.style.overflow = current.overflow;
    if (safePublicReturn(window.location.pathname + window.location.search)) {
      document.title = current.title;
      if (current.canonical !== null) document.querySelector('link[rel="canonical"]')?.setAttribute("href", current.canonical);
    }
  }
  useEffect(() => {
    const documentToken = Math.random().toString(36).slice(2);
    function begin(id: string, from: string, push: boolean) {
      if (active.current || typeof HTMLDialogElement === "undefined" || typeof HTMLDialogElement.prototype.showModal !== "function") return false;
      try { if (localStorage.getItem("xcliprank_age_confirmed_v1") !== "yes") return false; } catch { return false; }
      const abort = new AbortController(), path = "/p/" + id;
      const current: Active = { id, from, path, abort, title: document.title, canonical: document.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? null, overflow: document.body.style.overflow };
      try { if (push) window.history.pushState({ ...window.history.state, twizouFastDetail: id, twizouFastFrom: from, twizouFastDocument: documentToken }, "", path); } catch { return false; }
      active.current = current; document.body.style.overflow = "hidden";
      document.title = "動画｜twizou"; document.querySelector('link[rel="canonical"]')?.setAttribute("href", window.location.origin + path);
      setView({ id, from, phase: "loading" });
      const timer = setTimeout(() => abort.abort(), 12000);
      void (async () => {
        try {
          const detail = await readJson("/api/public-video?type=detail-core&value=" + id, abort.signal) as Detail | null;
          if (active.current !== current) return;
          if (!detail) { setView({ id, from, phase: "missing" }); return; }
          if (detail.video.id !== id || !detail.video.eligible || !detail.video.videoUrl) throw Error("PUBLIC_DETAIL_INVALID");
          document.title = detail.metadata.title; document.querySelector('link[rel="canonical"]')?.setAttribute("href", detail.metadata.canonical); setView({ id, from, phase: "ready", detail });
          clearTimeout(timer);
          // Optional suggestions never delay the player and never scan all tag counts.
          const relatedTimer = setTimeout(() => abort.abort(), 6000);
          try {
            const related = await readJson("/api/public-video?type=related&value=" + id, abort.signal) as Related | null;
            if (active.current === current && related) setView({ id, from, phase: "ready", detail, related });
          } catch { /* The browse link remains available. */ }
          finally { clearTimeout(relatedTimer); }
        } catch { if (active.current === current) setView({ id, from, phase: "failed" }); }
        finally { clearTimeout(timer); }
      })();
      return true;
    }
    function open(event: Event) {
      if (!(event instanceof CustomEvent) || !event.cancelable) return;
      const id = event.detail?.id, from = safePublicReturn(window.location.pathname + window.location.search);
      if (typeof id === "string" && /^[1-9][0-9]{1,24}$/.test(id) && from && begin(id, from, true)) event.preventDefault();
    }
    function pop() {
      release(); setView(null);
      const state = window.history.state, id = state?.twizouFastDetail, from = safePublicReturn(state?.twizouFastFrom);
      if (typeof id === "string" && /^[1-9][0-9]{1,24}$/.test(id) && window.location.pathname === "/p/" + id && from) {
        if (state.twizouFastDocument !== documentToken || !begin(id, from, false)) window.location.reload();
      }
    }
    window.addEventListener(PUBLIC_DETAIL_OPEN_EVENT, open); window.addEventListener("popstate", pop);
    return () => { window.removeEventListener(PUBLIC_DETAIL_OPEN_EVENT, open); window.removeEventListener("popstate", pop); release(); };
  }, []);
  useEffect(() => { if (active.current && pathname !== active.current.path) { release(); setView(null); } }, [pathname]);
  useEffect(() => {
    const node = dialog.current; if (!view || !node) return;
    if (!node.open) node.showModal();
    return () => { if (node.open) node.close(); };
  }, [view?.id]);
  if (!view) return null;
  const d = view.detail, v = d?.video, facts = v ? [...publicVideoFacts(v, d.technical), ...publicRankFacts(d.rank, d.firstRankedAt)] : [];
  function close() { if (active.current && window.history.state?.twizouFastDetail === active.current.id) window.history.back(); else window.location.assign(view!.from); }
  return <dialog ref={dialog} aria-label="動画" aria-modal="true" data-twizou-fast-detail={view.id} onCancel={event => { if (event.target !== event.currentTarget) return; event.preventDefault(); close(); }} style={{ position: "fixed", inset: 0, width: "100vw", height: "100dvh", maxWidth: "none", maxHeight: "none", margin: 0, padding: "20px max(12px, env(safe-area-inset-right))", border: 0, background: "#080c10", color: "#f6f7f8", overflow: "auto", boxSizing: "border-box" }}>
    <main className="public-post-page" style={{ maxWidth: 1100, margin: "0 auto" }}>
      <SiteBrand />
      <button type="button" className="public-post-close" aria-label="動画を閉じて元の一覧へ戻る" onClick={close}>×<span className="public-post-close-text">閉じる</span></button>
      {view.phase === "loading" ? <><h1>動画</h1><div className="public-post-player" style={{ minHeight: "50vh", background: "#10151b", display: "grid", placeItems: "center" }}><p role="status">動画を開いています…</p></div></> : null}
      {view.phase === "missing" ? <><h1>この動画は現在表示できません</h1><p><Link href="/browse" prefetch={false}>動画一覧を見る</Link></p></> : null}
      {view.phase === "failed" ? <><h1>動画を開けませんでした</h1><p><a href={"/p/" + view.id} onClick={event => { event.preventDefault(); window.location.assign("/p/" + view.id); }}>通常の動画ページで開く</a></p></> : null}
      {v && d && view.phase === "ready" ? <>
        <PublicPostEngagement postId={v.id} sourcePage={view.from} />
        <div className="public-post-player"><DirectPlaybackVideo trackQualifiedView engagementSourcePage={view.from} key={v.id} postId={v.id} src={v.videoUrl} poster={v.posterUrl ?? undefined} controls playsInline preload="metadata" aria-label="動画プレーヤー" style={{ width: "100%", maxHeight: "70vh", background: "#000" }} /></div>
        <h1>{v.authorName ?? v.handle ?? "投稿者"}の動画</h1>
        {accountKey(v) ? <div className="post-author-follow"><Link className="post-author-name" href={authorHref(v)!} prefetch={false}>{v.authorName ?? v.handle ?? "投稿者"}</Link><FollowButton accountKey={accountKey(v)!} compact /></div> : null}
        <PostActionBar video={v} />
        {v.text?.trim() ? <PublicPostText text={v.text} tags={d.labels.map(label => ({ name: label.name, href: tagHref(label) }))} /> : null}
        {d.labels.length ? <section aria-label="この動画のタグ"><h2>この動画に付けられたタグ</h2><nav className="public-post-tags">{d.labels.map(label => <Link key={label.id} href={tagHref(label)} prefetch={false}>{label.name}</Link>)}</nav></section> : null}
        {facts.length ? <dl className="public-video-facts" aria-label="動画の情報">{facts.map(fact => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.dateTime ? <time dateTime={fact.dateTime}>{fact.value}</time> : fact.value}</dd></div>)}</dl> : null}
        <nav className="post-breadcrumb" aria-label="現在位置"><Link href="/rising" prefetch={false}>twizou</Link> ／ <Link href={authorHref(v)!} prefetch={false}>{v.authorName ?? v.handle ?? "投稿者"}</Link> ／ 動画</nav>
        {d.metadata.saveCount !== null && d.metadata.saveCount > 0 ? <p>サイト内の保存操作：{d.metadata.saveCount}件</p> : null}
        {view.related ? <><section><h2>同じ投稿者の他動画</h2><PublicVideoCards videos={view.related.sameAuthor} returnTo={view.from} /></section><section><h2>関連動画</h2><PublicVideoCards videos={view.related.related.length ? view.related.related : view.related.recommended ?? []} returnTo={view.from} /></section></> : <p>ほかの動画は<Link href="/browse" prefetch={false}>動画一覧</Link>からご覧ください。</p>}
      </> : null}
    </main>
  </dialog>;
}
