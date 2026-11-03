import Link from "next/link";

/** Shared public masthead. The icon is decorative; the link has its own name. */
export default function SiteBrand() {
  return <div className="site-brand-band">
    <Link className="site-brand-link" href="/rising" aria-label="twizouのトップページ（急上昇）へ">
      <img src="/twizou-mark.svg" width="64" height="64" alt="" aria-hidden="true" />
      <span>twizou</span>
    </Link>
    <nav className="site-discovery-nav" aria-label="動画を探す"><a href="/discover?mode=random">全期間</a><a href="/discover?mode=tier">Tier別</a><a href="/discover?mode=month">月別</a><a href="/discover?mode=search">検索</a><Link href="/favorites" prefetch={false}>☆ お気に入り</Link></nav>
  </div>;
}
