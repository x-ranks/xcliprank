import Link from "next/link";
import PublicPostLink from "./PublicPostLink";
import PublicListRestore from "./PublicListRestore";
import { authorHref, type PublicVideo } from "../../lib/public-video-core";

function excerpt(text: string | null): string {
  return Array.from(text?.replace(/\s+/g, " ").trim() ?? "").slice(0, 120).join("");
}

export default function PublicVideoCards({ videos, returnTo = "/", nativeNavigation = false }: { videos: PublicVideo[]; returnTo?: string; nativeNavigation?: boolean }) {
  return <div className="video-grid"><PublicListRestore />{videos.map(v => {
    const author = v.authorName?.trim() || (v.handle ? `@${v.handle}` : "投稿者");
    const summary = excerpt(v.text);
    const authorPage = authorHref(v);
    return <article className="video-card" key={v.id}>
      <PublicPostLink id={v.id} returnTo={returnTo} nativeNavigation={nativeNavigation} ariaLabel={`${author}の動画を開く${summary ? `：${summary}` : ""}`} style={{ display: "block", color: "inherit", textDecoration: "none" }}>
        {v.posterUrl
          ? <img src={v.posterUrl} alt={`${author}の動画のサムネイル`} width={392} height={220} loading="lazy" style={{ display: "block", width: "100%", height: 220, objectFit: "contain", background: "#08111e" }} />
          : <div style={{ display: "grid", placeItems: "center", height: 220, background: "#08111e" }}>動画を開く</div>}
        <p style={{ padding: "0 11px", overflow: "hidden", display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 2, overflowWrap: "anywhere" }}>{summary || `${author}の動画`}</p>
        {(v.views != null || v.likes != null || v.bookmarks != null) && <p style={{ padding: "0 11px", fontSize: 12 }}>X側：{v.views != null ? `表示 ${v.views.toLocaleString()}` : ""} {v.likes != null ? `いいね ${v.likes.toLocaleString()}` : ""} {v.bookmarks != null ? `ブックマーク ${v.bookmarks.toLocaleString()}` : ""}</p>}
      </PublicPostLink>
      <p style={{ padding: "0 11px 11px" }}>{authorPage ? <Link href={authorPage}>{author}</Link> : author}</p>
    </article>;
  })}</div>;
}
