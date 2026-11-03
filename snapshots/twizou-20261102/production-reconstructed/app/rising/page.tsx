import { headers } from "next/headers";
import { after } from "next/server";
import SiteFooter from "../components/SiteFooter";
import SiteBrand from "../components/SiteBrand";
import type { Metadata } from "next";
import Link from "next/link";
import PublicPostLink from "../components/PublicPostLink";
import VideoDurationBadge from "../components/VideoDurationBadge";
import FavoriteButton from "../components/FavoriteButton";
import PublicThumbnail from "../components/PublicThumbnail";
import { loadRisingRanking } from "../../lib/rising-ranking";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: { absolute: "急上昇のTwitter動画ランキング・保存｜twizou" },
  description: "twizou内で人気の動画をまとめました！",
  alternates: { canonical: "/rising" },
  robots: { index: true, follow: true, "max-image-preview": "large" }
};

export default async function RisingPage() {
  const waitForRefresh = (await headers()).get("x-twizou-rising-refresh") === "wait";
  const { posts, updatedAt } = await loadRisingRanking(waitForRefresh ? {} : { deferRefresh: after });
  return <main data-rising-updated-at={updatedAt}>
    <header className="ranking-page-header">
      <SiteBrand />
      <h1 className="ranking-page-title">急上昇ランキング</h1>
      <p className="ranking-page-description">twizou内で人気の動画をまとめました！</p>
    </header>
    <nav className="ranking-page-nav" aria-label="ランキングを選択">
      <Link prefetch={false} href="/rising" className="active" aria-current="page">急上昇</Link>
      <Link prefetch={false} href="/">新着</Link><Link prefetch={false} href="/ranking/daily">24時間</Link><Link prefetch={false} href="/ranking/weekly">週間</Link>
      <Link prefetch={false} href="/reels">リール</Link><Link prefetch={false} href="/download">動画保存</Link>
    </nav>
    {posts.length ? <div className="video-grid">{posts.map((post, index) => <article className="video-card" key={post.x_post_id}>
      <PublicPostLink id={post.x_post_id} returnTo="/rising" ariaLabel={`${index + 1}位の動画を開く`} style={{ display: "block", color: "inherit", textDecoration: "none" }}>
        <div className="thumb-wrap">
          {post.preview_image_url ? <PublicThumbnail className="thumb" src={post.preview_image_url} alt={`${post.author_name ?? post.author_username ?? "投稿者"}の動画のサムネイル`} width={392} height={220} decoding="async" fetchPriority={index === 0 ? "high" : "auto"} loading={index === 0 ? "eager" : "lazy"} /> : <div className="thumb thumb-fallback">X VIDEO</div>}
          <span className="rank-badge">#{index + 1}</span>
          {post.video_url ? <VideoDurationBadge postId={post.x_post_id} /> : null}
        </div>
        <div className="card-body"><strong>{post.author_name ?? post.author_username ?? "投稿者"}</strong>
          <p>サイトで開いた回数 {post.siteOpens}回 ／ 保存操作 {post.siteSaves}回</p></div>
      </PublicPostLink>
      <FavoriteButton id={post.x_post_id} />
    </article>)}</div> : <p>集計対象の動画はまだありません。</p>}
    <section className="seo-info" aria-labelledby="about-ranking">
      <h2 id="about-ranking">Twitter動画ランキングについて</h2>
      <p>人気の動向は<Link prefetch={false} href="/ranking/daily">24時間ランキング</Link>と<Link prefetch={false} href="/ranking/weekly">週間ランキング</Link>から確認できます。</p>
    </section>
    <SiteFooter />
  </main>;
}
