import Link from "next/link";
import VideoDownloadButton from "./VideoDownloadButton";
import FavoriteButton from "./FavoriteButton";
import { authorHref, originalHref, type PublicVideo } from "../../lib/public-video-core";
import { shareVideoHref } from "../../lib/share-video";

// One save button, favorite and share icons, and a "more" menu. Used by the video page and the in-list detail viewer.
export default function PostActionBar({ video }: { video: PublicVideo }) {
  const v = video, author = authorHref(v);
  return <div className="public-post-actions" aria-label="動画の操作">
    <VideoDownloadButton postId={v.id} showCaption={false} />
    <FavoriteButton id={v.id} />
    <a className="share-to-x" href={shareVideoHref(v.id, null, { author: v.authorName ?? v.handle })!} target="_blank" rel="noopener noreferrer" aria-label="この動画をXで共有">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 15V4M8 8l4-4 4 4" /><path d="M5 12v6.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V12" /></svg>
      <span className="visually-hidden">Xで共有</span>
    </a>
    <details className="post-more">
      <summary aria-label="その他の操作">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg>
      </summary>
      <div className="post-more-menu">
        <a href={originalHref(v)} target="_blank" rel="noopener noreferrer">元投稿をXで開く</a>
        {author ? <Link href={author} prefetch={false}>投稿者ページを見る</Link> : null}
        <Link href={`/removal-request?post=${v.id}`} prefetch={false} rel="nofollow">この動画を報告する</Link>
      </div>
    </details>
  </div>;
}
