"use client";
import Link from "next/link";
import PublicPostLink from "./PublicPostLink";
import PublicListRestore from "./PublicListRestore";
import { newestPageHref, rankingHref } from "../../lib/ranking-pagination";
import { readRankingUpdate, formatRankingTime, latestRankingHref, type RankingUpdate } from "../../lib/ranking-update";
import type { RankingPagination } from "../../lib/ranking-pagination";
import DirectPlaybackVideo from "./DirectPlaybackVideo";

import { directPlaybackUrl } from "../../lib/browser-direct-playback";

import VideoDownloadButton from "./VideoDownloadButton";

import { useEffect, useMemo, useRef, useState } from "react";
import { trackEngagement } from "../../lib/engagement-client";

export type RankPost = {
  x_post_id: string;
  ranking_position?: number;
  author_username: string | null;
  author_name: string | null;
  x_url: string;
  preview_image_url: string | null;
  video_url: string | null;
  video_bitrate: number | null;
  views: number;
  likes: number;
  reposts: number;
  replies: number;
  score: number;
  adult_tier: string | null;
  created_at: string;
  ranking_supplemented?: boolean;
};

export type Range = "trending" | "daily" | "weekly";

type RankingClientProps = {
  initialRange?: Range;
  initialPosts?: RankPost[];
  range?: Range;
  fixedRange?: boolean;
  pagination?: RankingPagination;
  edition?: string;
  initialUpdate?: RankingUpdate;
};

const INITIAL_COUNTS: Record<Range, number> = {
  trending: 50,
  daily: 50,
  weekly: 24
};

const LOAD_MORE_COUNTS: Record<Range, number> = {
  trending: 25,
  daily: 25,
  weekly: 12
};

export default function RankingClient({
  initialRange = "trending",
  initialPosts = [],
  range: controlledRange,
  fixedRange = false,
  pagination,
  edition,
  initialUpdate
}: RankingClientProps = {}) {
  const [range, setRange] = useState<Range>(initialRange);
  const activeRange = controlledRange ?? range;
  const query = new URLSearchParams({ range: activeRange });
  if (pagination && activeRange === "trending") query.set("page", String(pagination.page));
  const activeEdition = pagination?.edition ?? edition;
  if (activeEdition) query.set("edition", activeEdition);
  const rankingQuery = query.toString();
  const [posts, setPosts] = useState<RankPost[]>(initialPosts);
  const [update, setUpdate] = useState<RankingUpdate>(() => initialUpdate ?? readRankingUpdate({edition: pagination?.edition ?? edition}));
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [loading, setLoading] = useState(initialPosts.length === 0);
  const [visibleCount, setVisibleCount] = useState(
    INITIAL_COUNTS[activeRange]
  );
  const [selectedPost, setSelectedPost] = useState<RankPost | null>(null);
  const [videoError, setVideoError] = useState(false);
  const initialRangeRef = useRef(activeRange);
  const initialPostsUsedRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    if (
      !initialPostsUsedRef.current &&
      initialPosts.length > 0 &&
      activeRange === initialRangeRef.current
    ) {
      initialPostsUsedRef.current = true;
      return;
    }

    setLoading(true);
    setRefreshFailed(false);
    setVisibleCount(INITIAL_COUNTS[activeRange]);

    fetch(`/api/rankings?${rankingQuery}`, {
      cache: "no-store", signal: controller.signal
    })
      .then(async (r) => { const json = await r.json(); if (!r.ok || json.ok !== true || !Array.isArray(json.data)) throw Error("RANKING_REFRESH_FAILED"); return json; })
      .then((json) => { if (!controller.signal.aborted) { setPosts(json.data); setUpdate(readRankingUpdate(json)); } })
      .catch(() => { if (!controller.signal.aborted) setRefreshFailed(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [activeRange, initialPosts.length, rankingQuery]);

  useEffect(() => {
    if (!selectedPost) return;

    setVideoError(false);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedPost(null);
      }
    };

    document.body.classList.add("modal-open");
    window.addEventListener("keydown", onKeyDown);

    trackEngagement({
      eventType: "video_open",
      xPostId: selectedPost.x_post_id,
      range: activeRange,
      source: "ranking_card"
    });

    const qualifiedViewTimer = window.setTimeout(() => {
      trackEngagement({
        eventType: "qualified_view",
        xPostId: selectedPost.x_post_id,
        range: activeRange,
        source: "ranking_modal",
        metadata: { seconds: 5 }
      });
    }, 5000);

    return () => {
      window.clearTimeout(qualifiedViewTimer);
      document.body.classList.remove("modal-open");
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [selectedPost, activeRange]);

  const visiblePosts = useMemo(
    () => pagination ? posts : posts.slice(0, visibleCount),
    [posts, visibleCount, pagination]
  );
  const updatedAt = update.updatedAt ?? update.snapshotAt;
  return (
    <>
      <div className="ranking-update" aria-live="polite" style={{display:"flex",flexWrap:"wrap",gap:"8px 18px",alignItems:"center",margin:"14px 0",fontSize:"14px"}}>
        <span>{updatedAt ? <>{update.precise ? "一覧更新：" : "集計基準："}<time dateTime={updatedAt}>{formatRankingTime(updatedAt)}</time>（日本時間）</> : "一覧の更新日時：未確認"}</span>
        <a href={latestRankingHref(activeRange)}>最新の一覧を表示</a>
        {refreshFailed ? <span role="status">最新の確認に失敗しました。表示中の一覧を保持しています。</span> : null}
      </div>
      <div className="download-page-link"><a href="/download">↓ 投稿URLから動画を保存</a></div>
      {fixedRange ? (
        <div className="ranking-page-summary">
          <span>{loading ? "集計中…" : pagination ? `${pagination.totalPosts}件中 ${pagination.page} / ${pagination.totalPages}ページ（このページ${posts.length}件）` : `${posts.length}件を表示`}</span>
        </div>
      ) : (
        <div className="tabs">
          {[
            ["trending", "新着"],
            ["daily", "24時間"],
            ["weekly", "週間"]
          ].map(([key, label]) => (
            <button
              key={key}
              className={activeRange === key ? "active" : ""}
              onClick={() => {
                const nextRange = key as Range;
                setRange(nextRange);
                trackEngagement({
                  eventType: "ranking_change",
                  range: nextRange,
                  source: "ranking_tabs"
                });
              }}
            >
              {label}
            </button>
          ))}

          <span className="result-count">
            {posts.length}件
          </span>
        </div>
      )}

      {loading && (
        <div className="status">
          読み込み中…
        </div>
      )}

      {!loading && posts.length === 0 && (
        <div className="empty">
          <h2>まだ投稿がありません</h2>

          <p>
            SupabaseへSQLを適用し、
            <code>/api/collect</code>
            を実行してください。
          </p>
        </div>
      )}

      <PublicListRestore ids={posts.map(p => p.x_post_id).join(",")} reveal={setVisibleCount} />
      <div className="video-grid">
        {visiblePosts.map((p, index) => (
          <article
            className="video-card"
            key={p.x_post_id}
          >
            <PublicPostLink id={p.x_post_id} returnTo={activeRange === "trending" ? newestPageHref(pagination?.page ?? 1, activeEdition) : rankingHref(activeRange, activeEdition)} style={{display:"block",color:"inherit",textDecoration:"none"}}>
            <div className="thumb-wrap">
              {p.preview_image_url ? (
                <img
                  src={p.preview_image_url}
                  alt={`${
                    p.author_name ??
                    p.author_username ??
                    "Xユーザー"
                  }の動画（ランキング${p.ranking_position ?? index + 1}位）`}
                  className="thumb"
                  loading={index < 4 ? "eager" : "lazy"}
                  fetchPriority={index === 0 ? "high" : "auto"}
                />
              ) : (
                <div className="thumb thumb-fallback">
                  X VIDEO
                </div>
              )}

              <span className="rank-badge">
                #{p.ranking_position ?? index + 1}
              </span>

              <span className="score-badge">
                {p.adult_tier ?? "-"} {p.score}
              </span>

              {p.video_url && (
                <span
                  className="video-ready-badge"
                  title="サイト内再生可能"
                >
                  ▶
                </span>
              )}

              <div
                className="play-button"
                aria-hidden="true"
              >
                ▶
              </div>
            </div>

            <div className="card-body">
              <div className="author-row">
                <strong>
                  {p.author_name ??
                    p.author_username ??
                    "X user"}
                </strong>

                {p.author_username && (
                  <span>
                    @{p.author_username}
                  </span>
                )}
              </div>

              <div className="compact-metrics">
                <span>
                  👁 {compact(p.views)}
                </span>

                <span>
                  ♥ {compact(p.likes)}
                </span>

                <span>
                  ↻ {compact(p.reposts)}
                </span>
              </div>
            </div>
            </PublicPostLink>
          </article>
        ))}
      </div>

      {!pagination && !loading &&
        visibleCount < posts.length && (
          <div className="load-more-wrap">
            <button
              className="load-more"
              onClick={() =>
                setVisibleCount(
                  (n) =>
                    n + LOAD_MORE_COUNTS[activeRange]
                )
              }
            >
              もっと見る
            </button>
          </div>
        )}

      {pagination && (
        <nav className="ranking-pagination" aria-label="新着動画のページ送り">
          {pagination.previousHref && <a href={pagination.previousHref}>前の50件</a>}
          <span aria-current="page">{pagination.page} / {pagination.totalPages}</span>
          {pagination.nextHref && <a className="load-more" href={pagination.nextHref}>さらに表示（次の50件）</a>}
          <a href="/">最新の新着へ</a>
        </nav>
      )}

      {selectedPost && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (
              event.currentTarget ===
              event.target
            ) {
              setSelectedPost(null);
            }
          }}
        >
          <section
            className="modal-panel"
            role="dialog"
            aria-modal="true"
          >
            <button
              className="modal-close"
              onClick={() =>
                setSelectedPost(null)
              }
              aria-label="閉じる"
            >
              ×
            </button>

            <div className="modal-heading">
              <div>
                <strong>
                  {selectedPost.author_name ??
                    selectedPost.author_username ??
                    "X user"}
                </strong>

                {selectedPost.author_username && (
                  <span>
                    @{selectedPost.author_username}
                  </span>
                )}
              </div>

              <a
                href={selectedPost.x_url}
                target="_blank"
                rel="noreferrer"
                onClick={() =>
                  trackEngagement({
                    eventType: "outbound_x",
                    xPostId: selectedPost.x_post_id,
                    range: activeRange,
                    source: "modal_heading"
                  })
                }
              >
                Xで開く ↗
              </a>
            </div>

            {selectedPost.video_url &&
            !videoError ? (
              <div className="direct-video-wrap">
                <DirectPlaybackVideo postId={selectedPost.x_post_id} key={selectedPost.x_post_id} src={directPlaybackUrl(selectedPost.video_url)}
                  className="direct-video"
                  controls
                  playsInline
                  autoPlay
                  preload="metadata"
                  poster={
                    selectedPost.preview_image_url ??
                    undefined
                  }
                  onError={() =>
                    setVideoError(true)
                  }
                >
                  
                </DirectPlaybackVideo>
              </div>
            ) : (
              <div className="video-fallback">
                <h3>
                  サイト内で再生できません
                </h3>

                <p>
                  この動画はX側の状態やURLの失効により、
                  直接再生できない可能性があります。
                </p>

                <a
                  href={selectedPost.x_url}
                  target="_blank"
                  rel="noreferrer"
                  className="fallback-button"
                  onClick={() =>
                    trackEngagement({
                      eventType: "outbound_x",
                      xPostId: selectedPost.x_post_id,
                      range: activeRange,
                      source: "video_fallback"
                    })
                  }
                >
                  Xで動画を見る
                </a>
              </div>
            )}

            {selectedPost.video_url && <VideoDownloadButton key={selectedPost.x_post_id} postId={selectedPost.x_post_id} />}
            <div className="modal-metrics">
              <span>
                👁{" "}
                {selectedPost.views.toLocaleString()}
              </span>

              <span>
                ♥{" "}
                {selectedPost.likes.toLocaleString()}
              </span>

              <span>
                ↻{" "}
                {selectedPost.reposts.toLocaleString()}
              </span>

              <span>
                💬{" "}
                {selectedPost.replies.toLocaleString()}
              </span>

              <span>
                Score {selectedPost.score}
              </span>

              {selectedPost.video_bitrate && (
                <span>
                  {Math.round(
                    selectedPost.video_bitrate /
                      1000
                  )}
                  kbps
                </span>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function compact(value: number) {
  return new Intl.NumberFormat(
    "ja-JP",
    {
      notation: "compact",
      maximumFractionDigits: 1
    }
  ).format(value || 0);
}
