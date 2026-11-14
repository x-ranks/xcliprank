import Link from "next/link";

export type SiteNavKey = "rising" | "ranking" | "new" | "accounts" | "months" | "tier" | "random" | "following";

// PC menu (phones use the bottom tabs and the MENU sheet instead). Plain text links; the current page gets a red underline.
const NAV: { key: SiteNavKey; href: string; label: string; plain?: boolean }[] = [
  { key: "rising", href: "/rising", label: "急上昇" },
  { key: "ranking", href: "/ranking/daily", label: "ランキング" },
  { key: "new", href: "/", label: "新着" },
  { key: "accounts", href: "/accounts", label: "投稿者" },
  { key: "months", href: "/months", label: "月別", plain: true },
  { key: "tier", href: "/discover?mode=tier", label: "Tier", plain: true },
  { key: "random", href: "/discover?mode=random", label: "ランダム", plain: true },
  { key: "following", href: "/following", label: "フォロー" },
];

/** Shared public masthead: one flat, sticky bar. The icon is decorative; the link has its own name. */
export default function SiteBrand({ showSearch = false, active }: { showSearch?: boolean; active?: SiteNavKey } = {}) {
  return <div className="site-brand-band">
    <Link className="site-brand-link" href="/rising" aria-label="twizouのトップページ（急上昇）へ">
      <img src="/twizou-mark.svg" width="64" height="64" alt="" aria-hidden="true" />
      <span>twizou</span>
    </Link>
    <nav className="site-discovery-nav" aria-label="動画を探す">
      {NAV.map(item => {
        const current = active === item.key ? "page" as const : undefined;
        return item.plain
          ? <a key={item.key} href={item.href} aria-current={current}>{item.label}</a>
          : <Link key={item.key} href={item.href} prefetch={false} aria-current={current}>{item.label}</Link>;
      })}
    </nav>
    <div className="site-brand-tools">
      {showSearch && <form className="site-search-form" action="/discover" method="get" role="search" aria-label="サイト内の動画検索">
        <input type="hidden" name="mode" value="search" />
        <input type="search" name="q" aria-label="タグ・本文・投稿者名" placeholder="タグ・本文・投稿者名" maxLength={80} required />
        <button type="submit" aria-label="動画を検索">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></svg>
        </button>
      </form>}
      <a className="site-search-icon" href="/discover?mode=search" aria-label="動画を検索">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></svg>
      </a>
      <Link className="site-fav-link" href="/favorites" prefetch={false} aria-label="お気に入り・履歴">☆</Link>
      <a className="site-x-link" href="https://x.com/twizou_rank" target="_blank" rel="noopener noreferrer">Xで新着情報</a>
    </div>
  </div>;
}
