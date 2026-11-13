import Link from "next/link";

/** Shared public masthead. The icon is decorative; the link has its own name. */
export default function SiteBrand({ showSearch = false }: { showSearch?: boolean } = {}) {
  return <div className="site-brand-band">
    <Link className="site-brand-link" href="/rising" aria-label="twizouのトップページ（急上昇）へ">
      <img src="/twizou-mark.svg" width="64" height="64" alt="" aria-hidden="true" />
      <span>twizou</span>
    </Link>
    <a className="site-search-icon" href="/discover?mode=search" aria-label="動画を検索">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></svg>
    </a>
    {showSearch && <form className="site-search-form" action="/discover" method="get" role="search" aria-label="サイト内の動画検索">
      <input type="hidden" name="mode" value="search" />
      <input type="search" name="q" aria-label="タグ・本文・投稿者名" placeholder="タグ・本文・投稿者名" maxLength={80} required />
      <button type="submit">動画を検索</button>
    </form>}
    <nav className="site-discovery-nav" aria-label="動画を探す">
      {!showSearch && <a className="site-search-link" href="/discover?mode=search">動画を検索</a>}
      <a href="/discover?mode=random">ランダム</a>
      <a href="/discover?mode=tier">Tierで探す</a>
      <a href="/discover?mode=month">月別</a>
      <Link href="/following" prefetch={false}>フォロー新着</Link>
      <Link href="/favorites" prefetch={false}>☆ お気に入り・履歴</Link>
      <a className="site-x-link" href="https://x.com/twizou_rank" target="_blank" rel="noopener noreferrer">Xで新着情報</a>
    </nav>
  </div>;
}
