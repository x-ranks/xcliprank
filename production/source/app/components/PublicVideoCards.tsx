import Link from "next/link";
import PublicThumbnail from "./PublicThumbnail";
import PublicPostLink from "./PublicPostLink";
import PublicListRestore from "./PublicListRestore";
import FavoriteButton from "./FavoriteButton";
import { authorHref, cardDate, type PublicVideo } from "../../lib/public-video-core";

function excerpt(text: string | null): string {
  return Array.from(text?.replace(/\s+/g, " ").trim() ?? "").slice(0, 120).join("");
}

export default function PublicVideoCards({ videos, returnTo = "/", nativeNavigation = false, priorityCount = 0 }: { videos: PublicVideo[]; returnTo?: string; nativeNavigation?: boolean; priorityCount?: number }) {
  return <div className="video-grid"><PublicListRestore />{videos.map((v, index) => {
    const author = v.authorName?.trim() || (v.handle ? `@${v.handle}` : "投稿者");
    const summary = excerpt(v.text);
    const authorPage = authorHref(v);
    const posted = cardDate(v.createdAt);
    return <article className="video-card" key={v.id}>
      <PublicPostLink id={v.id} returnTo={returnTo} nativeNavigation={nativeNavigation} ariaLabel={`${author}の動画を開く${summary ? `：${summary}` : ""}`} style={{ display: "block", color: "inherit", textDecoration: "none" }}>
        {v.posterUrl
          ? <PublicThumbnail src={v.posterUrl} alt={`${author}の動画のサムネイル`} width={392} height={220} loading={index < Math.min(4, Math.max(0, priorityCount)) ? "eager" : "lazy"} decoding="async" fetchPriority={priorityCount > 0 && index === 0 ? "high" : "auto"} style={{ display: "block", width: "100%", height: 220, objectFit: "contain", background: "#08111e" }} />
          : <div style={{ display: "grid", placeItems: "center", height: 220, background: "#08111e" }}>動画を開く</div>}
        <p style={{ padding: "0 11px", overflow: "hidden", display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 2, overflowWrap: "anywhere" }}>{summary || `${author}の動画`}</p>
        {((v.views ?? 0) > 0 || v.likes != null || v.bookmarks != null) && <p className="public-card-x-stats">
          {v.views != null && v.views > 0 && <span>X表示 {v.views.toLocaleString()}</span>}
          {v.bookmarks != null && <span>ブックマーク {v.bookmarks.toLocaleString()}</span>}
          {v.likes != null && <span className="public-card-x-likes">いいね {v.likes.toLocaleString()}</span>}
        </p>}
      </PublicPostLink>
      <p className="public-card-byline" style={{ padding: "0 11px 11px" }}>{authorPage ? <Link prefetch={false} href={authorPage}>{author}</Link> : author}{posted && <time className="public-card-date" dateTime={posted.iso}>{posted.text}</time>}</p><FavoriteButton id={v.id} />
    </article>;
  })}</div>;
}
