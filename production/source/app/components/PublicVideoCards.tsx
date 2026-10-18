import Link from "next/link";
import PublicPostLink from "./PublicPostLink";
import PublicListRestore from "./PublicListRestore";
import { authorHref, postHref, type PublicVideo } from "../../lib/public-video-core";
export default function PublicVideoCards({ videos, returnTo = "/" }: { videos: PublicVideo[]; returnTo?: string }) {
  return <div className="video-grid"><PublicListRestore />{videos.map(v => <article className="video-card" key={v.id}>
    <PublicPostLink id={v.id} returnTo={returnTo} style={{ display: "block", color: "inherit", textDecoration: "none" }}>
      {v.posterUrl ? <img src={v.posterUrl} alt={`${v.authorName ?? v.handle ?? "投稿者"}の動画`} loading="lazy" style={{ width: "100%", height: 220, objectFit: "contain", background: "#08111e" }} /> : <p>動画を開く</p>}
      <p>{v.text?.slice(0, 80) || `投稿 ${v.id}の動画`}</p>
    </PublicPostLink><p><Link href={authorHref(v)!}>{v.authorName ?? v.handle ?? "投稿者ページ"}</Link></p>
  </article>)}</div>;
}
