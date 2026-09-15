"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { trackEngagement } from "../../lib/engagement-client";

export type RankPost = {
  x_post_id: string;
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
  fixedRange = false
}: RankingClientProps = {}) {
  const [range, setRange] = useState<Range>(initialRange);
  const activeRange = controlledRange ?? range;
  const [posts, setPosts] = useState<RankPost[]>(initialPosts);
  const [loading, setLoading] = useState(initialPosts.length === 0);
  const [visibleCount, setVisibleCount] = useState(
    INITIAL_COUNTS[activeRange]
  );
  const [selectedPost, setSelectedPost] = useState<RankPost | null>(null);
  const [videoError, setVideoError] = useState(false);
  const initialRangeRef = useRef(activeRange);
  const initialPostsUsedRef = useRef(false);

  useEffect(() => {
    if (
      !initialPostsUsedRef.current &&
      initialPosts.length > 0 &&
      activeRange === initialRangeRef.current
    ) {
      initialPostsUsedRef.current = true;
      return;
    }

    setLoading(true);
    setVisibleCount(INITIAL_COUNTS[activeRange]);

    fetch(`/api/rankings?range=${activeRange}`, {
      cache: "no-store"
    })
      .then((r) => r.json())
      .then((json) => setPosts(json.data ?? []))
      .finally(() => setLoading(false));
  }, [activeRange, initialPosts.length]);

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
    () => posts.slice(0, visibleCount),
    [posts, visibleCount]
  );
  return (
    <>
      {fixedRange ? (
        <div className="ranking-page-summary">
          <span>{loading ? "集計中…" : `${posts.length}件を表示`}</span>
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

      <div className="video-grid">
        {visiblePosts.map((p, index) => (
          <article
            className="video-card"
            key={p.x_post_id}
            onClick={() => setSelectedPost(p)}
            tabIndex={0}
            role="button"
            onKeyDown={(event) => {
              if (
                event.key === "Enter" ||
                event.key === " "
              ) {
                event.preventDefault();
                setSelectedPost(p);
              }
            }}
          >
            <div className="thumb-wrap">
              {p.preview_image_url ? (
                <img
                  src={p.preview_image_url}
                  alt={`${
                    p.author_name ??
                    p.author_username ??
                    "Xユーザー"
                  }の動画（ランキング${index + 1}位）`}
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
                #{index + 1}
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
          </article>
        ))}
      </div>

      {!loading &&
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
                <video
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
                  <source
                    src={`/api/video?url=${encodeURIComponent(
                      selectedPost.video_url
                    )}`}
                    type="video/mp4"
                  />
                </video>
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
