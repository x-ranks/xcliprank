"use client";
import Link from "next/link";
import PublicThumbnail from "./PublicThumbnail";
import PublicPostLink from "./PublicPostLink";
import PublicListRestore from "./PublicListRestore";
import { newestPageHref, rankingHref } from "../../lib/ranking-pagination";
import { readRankingUpdate, formatRankingTime, latestRankingHref, type RankingUpdate } from "../../lib/ranking-update";
import type { RankingPagination } from "../../lib/ranking-pagination";
import useSuspendedAuthors from "./useSuspendedAuthors";
import { isUnavailablePost } from "../../lib/post-status";
import DirectPlaybackVideo from "./DirectPlaybackVideo";
import ExternalVideo from "./ExternalVideo";
import type { ReactNode } from "react";

import { directPlaybackUrl } from "../../lib/browser-direct-playback";
import { INITIAL_RANKING_COUNTS } from "../../lib/ranking-display";

import VideoDownloadButton from "./VideoDownloadButton";
import FavoriteButton from "./FavoriteButton";

import { useEffect, useMemo, useRef, useState } from "react";
import VideoDurationBadge from "./VideoDurationBadge";
import { trackEngagement } from "../../lib/engagement-client";

export type RankPost = {
  author_id?: string;
  has_video?: boolean;
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
  bookmarks?: number | null;
  reposts: number;
  replies: number;
  score: number;
  adult_tier: string | null;
  created_at: string;
  ranking_supplemented?: boolean;
  manual_id?: string;
  manual_media_url?: string | null;
  manual_title?: string;
};

// Rank shown at the bottom-left of a card, the same on every ranking page: yellow, top 5 stronger, a crown for 1st.
function RankLabel({ rank }: { rank: number }) {
  return <b className={rank <= 5 ? "public-card-rank public-card-rank-top" : "public-card-rank"} data-rank={rank}>{rank === 1 ? <span className="public-card-crown" aria-hidden="true">👑</span> : null}{rank}位</b>;
}

// Thumbnail alt text: who posted it and when (the rank is already shown by the badge), so cards are not all the same sentence.
function thumbnailAlt(p: RankPost) {
  const name = p.author_name ?? p.author_username ?? "投稿者";
  const t = Date.parse(p.created_at);
  if (!Number.isFinite(t)) return `${name}のX動画`;
  const d = new Date(t + 9 * 3600000);
  return `${name}のX動画（${d.getUTCMonth() + 1}月${d.getUTCDate()}日の投稿）`;
}

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

const INITIAL_COUNTS: Record<Range, number> = INITIAL_RANKING_COUNTS;

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
  const blockedKeys = useSuspendedAuthors();
  const blocked = useMemo(() => new Set(blockedKeys), [blockedKeys]);
  const [range, setRange] = useState<Range>(initialRange);
  const activeRange = controlledRange ?? range;
  const query = new URLSearchParams({ range: activeRange });
  if (pagination && activeRange === "trending") query.set("page", String(pagination.page));
  const activeEdition = pagination?.edition ?? edition;
  if (activeEdition) query.set("edition", activeEdition);
  const rankingQuery = query.toString();
  const [posts, setPosts] = useState<RankPost[]>(initialPosts);
  const [update, setUpdate] = useState<RankingUpdate>(() => initialUpdate ?? readRankingUpdate({edition: pagination?.edition ?? edition}));
  const [morePage, setMorePage] = useState<RankingPagination | undefined>(pagination);
  const [moreLoading, setMoreLoading] = useState(false);
  const [moreError, setMoreError] = useState(false);
  const moreRequest = useRef<AbortController | null>(null);
  useEffect(() => () => { moreRequest.current?.abort(); }, []);
  useEffect(() => { moreRequest.current?.abort(); setMorePage(pagination); setMoreLoading(false); setMoreError(false); }, [rankingQuery, pagination]);
  async function appendNext(event: React.MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !morePage?.nextHref) return;
    event.preventDefault(); if (moreRequest.current) return;
    const controller = new AbortController(); moreRequest.current = controller; setMoreLoading(true); setMoreError(false);
    try {
      const next = morePage.page + 1;
      const q = new URLSearchParams({ range: "trending", page: String(next), edition: morePage.edition });
      const r = await fetch("/api/rankings?" + q, { cache: "no-store", signal: controller.signal });
      const value = await r.json();
      if (!r.ok || value.ok !== true || !Array.isArray(value.data) || value.data.length > 50 || value.pagination?.page !== next || value.pagination?.edition !== morePage.edition) throw Error("APPEND_FAILED");
      if (!controller.signal.aborted) {
        setPosts(old => { const known = new Set(old.map(post => post.x_post_id)); return [...old, ...value.data.filter((post: RankPost) => !known.has(post.x_post_id))].slice(0, 500); });
        setMorePage(value.pagination);
      }
    } catch { if (!controller.signal.aborted) setMoreError(true); }
    finally { if (moreRequest.current === controller) { moreRequest.current = null; setMoreLoading(false); } }
  }
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
    if (selectedPost && isUnavailablePost(selectedPost, blocked)) setSelectedPost(null);
  }, [selectedPost, blocked]);

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

    if (!selectedPost.manual_id) trackEngagement({
      eventType: "video_open",
      xPostId: selectedPost.x_post_id,
      range: activeRange,
      source: "ranking_card"
    });

    const qualifiedViewTimer = window.setTimeout(() => {
      if (!selectedPost.manual_id) trackEngagement({
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

  const safePosts = useMemo(() => posts.filter(p => !isUnavailablePost(p, blocked)), [posts, blocked]);
  const visiblePosts = useMemo(
    () => pagination ? safePosts : safePosts.slice(0, visibleCount),
    [safePosts, visibleCount, pagination]
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
          <span>{loading ? "集計中…" : pagination ? `${pagination.totalPosts}件中 ${safePosts.length}件を表示（${pagination.page}〜${morePage?.page ?? pagination.page}ページ）` : `${safePosts.length}件を表示`}</span>
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
            {safePosts.length}件
          </span>
        </div>
      )}

      {loading && (
        <div className="status">
          読み込み中…
        </div>
      )}

      {!loading && safePosts.length === 0 && (
        <div className="empty">
          <h2>表示できる動画がありません</h2>

          <p>
            時間をおいて再度確認してください。
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
            <RankingCardOpen post={p} returnTo={activeRange === "trending" ? newestPageHref(pagination?.page ?? 1, activeEdition) : rankingHref(activeRange, activeEdition)} onOpen={() => setSelectedPost(p)}>
            <div className="thumb-wrap">
              {p.preview_image_url ? (
                <PublicThumbnail
                  src={p.preview_image_url}
                  alt={thumbnailAlt(p)}
                  className="thumb"
                  width={392}
                  height={220}
                  decoding="async"
                  loading={index < 3 ? "eager" : "lazy"}
                  fetchPriority={index === 0 ? "high" : "auto"}
                />
              ) : (
                <div className="thumb thumb-fallback">
                  {p.manual_id ? "VIDEO" : "X VIDEO"}
                </div>
              )}

              {(p.has_video || p.video_url) && !p.manual_id && <VideoDurationBadge postId={p.x_post_id} />}

              <div
                className="play-button"
                aria-hidden="true"
              >
                ▶
              </div>
            </div>

            <div className="card-body">
              <div className="author-row">
                <RankLabel rank={p.ranking_position ?? index + 1} />
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

              {!p.manual_id && <div className="compact-metrics">
                <span>
                  👁 {compact(p.views)}
                </span>

                <span>
                  ♥ {compact(p.likes)}
                </span>

                {p.bookmarks != null && <span title="Xのブックマーク数">
                  Xのブックマーク {compact(p.bookmarks)}
                </span>}

                <span>
                  ↻ {compact(p.reposts)}
                </span>
              </div>}
            </div>
            </RankingCardOpen>
            {!p.manual_id && <FavoriteButton id={p.x_post_id} />}
          </article>
        ))}
      </div>

      {!pagination && !loading &&
        visibleCount < safePosts.length && (
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
          <span>{safePosts.length}件を表示 / 全{pagination.totalPosts}件</span>
          {morePage?.nextHref && <a className="load-more" href={morePage.nextHref} onClick={appendNext} aria-disabled={moreLoading} aria-busy={moreLoading}>{moreLoading ? "読み込み中…" : "さらに表示（次の50件）"}</a>}
          {moreError && <p role="status">追加の読み込みに失敗しました。再試行するか、<a href={morePage?.nextHref ?? pagination.nextHref ?? "/"}>次のページを開く</a></p>}
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
              >
                {selectedPost.manual_id ? "元URLを開く ↗" : "Xで開く ↗"}
              </a>
            </div>

            {selectedPost.manual_id ? (selectedPost.manual_media_url ?
              <ExternalVideo url={selectedPost.manual_media_url} poster={selectedPost.preview_image_url} /> :
              <p><a href={selectedPost.x_url} target="_blank" rel="noopener noreferrer">元ページで見る ↗</a></p>) : selectedPost.video_url &&
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
            ) : !selectedPost.manual_id ? (
              <div className="video-fallback">
                <h3>
                  動画が再生できません。
                </h3>

                <p>
                  投稿から動画が再生できるかお試しください。
                </p>

                <a
                  href={selectedPost.x_url}
                  target="_blank"
                  rel="noreferrer"
                  className="fallback-button"
                >
                  Xで動画を見る
                </a>
              </div>
            ) : null}

            {selectedPost.video_url && !selectedPost.manual_id && <VideoDownloadButton key={selectedPost.x_post_id} postId={selectedPost.x_post_id} />}
            {!selectedPost.manual_id && <div className="modal-metrics">
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
            </div>}
          </section>
        </div>
      )}
    </>
  );
}

const compactNumber = new Intl.NumberFormat("ja-JP", { notation: "compact", maximumFractionDigits: 1 });
function compact(value: number) {
  return compactNumber.format(value || 0);
}

function RankingCardOpen({ post, returnTo, onOpen, children }: { post: RankPost; returnTo: string; onOpen: () => void; children: ReactNode }) {
  if (post.manual_id) return <button type="button" onClick={onOpen} style={{ display: "block", width: "100%", padding: 0,
    border: 0, background: "transparent", color: "inherit", textAlign: "left", cursor: "pointer" }}>{children}</button>;
  return <PublicPostLink id={post.x_post_id} returnTo={returnTo} style={{ display: "block", color: "inherit", textDecoration: "none" }}>{children}</PublicPostLink>;
}

