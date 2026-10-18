"use client";
import DirectPlaybackVideo from "../components/DirectPlaybackVideo";

import { directPlaybackUrl } from "../../lib/browser-direct-playback";

import VideoDownloadButton from "../components/VideoDownloadButton";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

type ReelPost = {
  x_post_id: string;
  author_username: string | null;
  author_name: string | null;
  x_url: string;
  preview_image_url: string | null;
  video_url: string;
  views: number;
  likes: number;
  reposts: number;
  replies: number;
  score: number;
  adult_tier: string;
  created_at: string;
};

function formatMetric(value: number) {
  return new Intl.NumberFormat("ja-JP", {
    notation: value >= 10000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value || 0);
}

function makeSeed() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random()}`;
}

export default function ReelsFeed() {
  const [posts, setPosts] = useState<ReelPost[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [muted, setMuted] = useState(true);
  const [playing, setPlaying] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [failedIds, setFailedIds] = useState<Set<string>>(new Set());
  const [reloadKey, setReloadKey] = useState(0);
  const feedRef = useRef<HTMLDivElement | null>(null);
  const slideRefs = useRef(new Map<number, HTMLElement>());
  const videoRefs = useRef(new Map<number, HTMLVideoElement>());

  useEffect(() => {
    document.body.classList.add("reels-mode");
    return () => document.body.classList.remove("reels-mode");
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    setLoading(true);
    setError("");
    setPosts([]);
    setActiveIndex(0);
    setFailedIds(new Set());

    fetch(`/api/reels?limit=120&seed=${encodeURIComponent(makeSeed())}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok || !body.ok) {
          throw new Error(body.error || "動画を取得できませんでした。");
        }
        return body;
      })
      .then((body) => setPosts(Array.isArray(body.data) ? body.data : []))
      .catch((reason) => {
        if (reason instanceof DOMException && reason.name === "AbortError") {
          return;
        }
        setError(reason instanceof Error ? reason.message : "動画を取得できませんでした。");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [reloadKey]);

  useEffect(() => {
    const root = feedRef.current;
    if (!root || posts.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

        if (!visible) return;
        const index = Number((visible.target as HTMLElement).dataset.index);
        if (Number.isInteger(index)) setActiveIndex(index);
      },
      { root, threshold: [0.6, 0.75, 0.9] }
    );

    slideRefs.current.forEach((slide) => observer.observe(slide));
    return () => observer.disconnect();
  }, [posts]);

  useEffect(() => {
    setPlaying(true);

    videoRefs.current.forEach((video, index) => {
      video.muted = muted;

      if (index === activeIndex) {
        video.play().catch(() => setPlaying(false));
      } else {
        video.pause();
      }
    });
  }, [activeIndex, muted, posts]);

  const goTo = useCallback((index: number) => {
    const bounded = Math.max(0, Math.min(posts.length - 1, index));
    slideRefs.current.get(bounded)?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, [posts.length]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowDown" || event.key === "PageDown") {
        event.preventDefault();
        goTo(activeIndex + 1);
      }

      if (event.key === "ArrowUp" || event.key === "PageUp") {
        event.preventDefault();
        goTo(activeIndex - 1);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeIndex, goTo]);

  const togglePlayback = (index: number) => {
    const video = videoRefs.current.get(index);
    if (!video) return;

    if (video.paused) {
      video.play().catch(() => setPlaying(false));
    } else {
      video.pause();
    }
  };

  const markFailed = (postId: string, index: number) => {
    setFailedIds((current) => new Set(current).add(postId));

    if (index === activeIndex && index < posts.length - 1) {
      window.setTimeout(() => goTo(index + 1), 900);
    }
  };

  if (loading) {
    return (
      <main className="reels-page reels-center-state">
        <div className="reels-spinner" aria-hidden="true" />
        <p>リールを準備しています…</p>
      </main>
    );
  }

  if (error || posts.length === 0) {
    return (
      <main className="reels-page reels-center-state">
        <h1>リールを表示できません</h1>
        <p>{error || "現在表示できるTier S〜Cの動画がありません。"}</p>
        <button type="button" onClick={() => setReloadKey((value) => value + 1)}>
          もう一度試す
        </button>
        <Link href="/">ランキングへ戻る</Link>
      </main>
    );
  }

  return (
    <main className="reels-page">
      <header className="reels-topbar">
        <Link className="reels-brand" href="/" aria-label="ランキングへ戻る">
          <span>X</span> CLIP RANK
        </Link>
        <span className="reels-position">
          {activeIndex + 1} / {posts.length}
        </span>
        <div className="reels-top-actions">
          <Link href="/download" className="reels-download-link" aria-label="投稿URLから動画を保存" title="動画保存">↓</Link>
          <button
            type="button"
            onClick={() => setReloadKey((value) => value + 1)}
            aria-label="動画をシャッフル"
            title="シャッフル"
          >
            ↻
          </button>
          <button
            type="button"
            onClick={() => setMuted((value) => !value)}
            aria-label={muted ? "音声をオンにする" : "音声をオフにする"}
          >
            {muted ? "🔇" : "🔊"}
          </button>
        </div>
      </header>

      <div className="reels-feed" ref={feedRef} aria-label="動画リール">
        {posts.map((post, index) => {
          const nearActive = Math.abs(index - activeIndex) <= 2;
          const failed = failedIds.has(post.x_post_id);
          const isActive = index === activeIndex;

          return (
            <article
              className="reel-slide"
              data-index={index}
              key={post.x_post_id}
              ref={(element) => {
                if (element) slideRefs.current.set(index, element);
                else slideRefs.current.delete(index);
              }}
            >
              <div className="reel-stage">
                {nearActive && !failed ? (
                  <DirectPlaybackVideo postId={post.x_post_id} recoverEnabled={isActive}
                    key={`${post.x_post_id}-loaded`}
                    ref={(element) => {
                      if (element) videoRefs.current.set(index, element);
                      else videoRefs.current.delete(index);
                    }}
                    className="reel-video"
                    src={directPlaybackUrl(post.video_url)}
                    poster={post.preview_image_url ?? undefined}
                    muted={muted}
                    playsInline
                    loop
                    preload={isActive ? "auto" : "metadata"}
                    onClick={() => togglePlayback(index)}
                    onPlay={() => isActive && setPlaying(true)}
                    onPause={() => isActive && setPlaying(false)}
                    onCanPlay={() => {
                      if (isActive) {
                        videoRefs.current.get(index)?.play().catch(() => setPlaying(false));
                      }
                    }}
                    onError={() => markFailed(post.x_post_id, index)}
                  />
                ) : (
                  <div
                    className="reel-poster"
                    style={post.preview_image_url ? {
                      backgroundImage: `url(${post.preview_image_url})`,
                    } : undefined}
                  />
                )}

                {failed && (
                  <div className="reel-unavailable">
                    <strong>この動画は再生できません</strong>
                    <span>次の動画へ移動します</span>
                  </div>
                )}

                {isActive && !playing && !failed && (
                  <button
                    type="button"
                    className="reel-play-button"
                    onClick={() => togglePlayback(index)}
                    aria-label="動画を再生"
                  >
                    ▶
                  </button>
                )}

                <div className="reel-gradient" aria-hidden="true" />

                <div className="reel-details">
                  <div className="reel-tier">TIER {post.adult_tier}</div>
                  <strong className="reel-author">
                    {post.author_name ?? post.author_username ?? "X user"}
                  </strong>
                  {post.author_username && (
                    <span className="reel-username">@{post.author_username}</span>
                  )}
                  <div className="reel-metrics" aria-label="投稿の反応数">
                    <span>👁 {formatMetric(post.views)}</span>
                    <span>♥ {formatMetric(post.likes)}</span>
                    <span>↻ {formatMetric(post.reposts)}</span>
                    <span>💬 {formatMetric(post.replies)}</span>
                  </div>
                  <p>動画はX上の公開投稿を参照して再生しています。</p>
                </div>

                <div className="reel-side-actions">
                  <Link href={`/p/${post.x_post_id}`} aria-label="動画の個別ページを開く">↗<small>詳細・保存</small></Link>
                  {post.video_url && <VideoDownloadButton postId={post.x_post_id} compact />}
                  <a
                    href={post.x_url}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(event) => event.stopPropagation()}
                    aria-label="Xで元投稿を開く"
                  >
                    𝕏
                    <small>元投稿</small>
                  </a>
                  <Link href="/removal-request" aria-label="削除要請フォーム">
                    !
                    <small>報告</small>
                  </Link>
                </div>

                {index < posts.length - 1 && (
                  <button
                    type="button"
                    className="reel-next-hint"
                    onClick={() => goTo(index + 1)}
                    aria-label="次の動画へ"
                  >
                    ︾
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </main>
  );
}
