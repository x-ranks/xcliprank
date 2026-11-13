import SiteBrand from "../../components/SiteBrand";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import PublicVideoCards from "../../components/PublicVideoCards";
import PublicPostLink from "../../components/PublicPostLink";
import FollowButton from "../../components/FollowButton";
import StructuredData from "../../components/StructuredData";
import type { PublicVideo } from "../../../lib/public-video-core";
import { PUBLIC_SITE, profileDate, profileNumber, tagHref } from "../../../lib/public-video-core";
import { readPublicAccount } from "../../../lib/public-video-server";
import { SITE_NAME } from "../../../lib/seo";
export const dynamic = "force-dynamic";
type Props = { params: Promise<{ key: string }>; searchParams?: Promise<{ page?: string | string[] }> };
async function readPage(props: Props) {
  const { key } = await props.params, search = await props.searchParams;
  const raw = search?.page;
  if (raw !== undefined && (typeof raw !== "string" || !/^[1-9]\d{0,3}$/.test(raw))) notFound();
  const page = raw === undefined ? 1 : Number(raw);
  return { d: await readPublicAccount(key, page), page };
}
export async function generateMetadata(props: Props): Promise<Metadata> {
  const { d, page } = await readPage(props);
  if (!d) return {};
  const canonical = `${PUBLIC_SITE}/accounts/${encodeURIComponent(d.canonicalKey)}${page > 1 ? `?page=${page}` : ""}`;
  const identity = d.handle && d.name !== d.handle && d.name !== "@" + d.handle ? `${d.name}(@${d.handle})` : d.name;
  const pilotHandle = page === 1 && d.canonicalKey === "gulililucky" && d.handle ? `@${d.handle}` : null;
  const title = pilotHandle
    ? `${pilotHandle}${d.name.replace(/^@/, "").toLowerCase() === d.handle?.toLowerCase() ? "" : `（${d.name}）`}のX動画一覧・保存｜${SITE_NAME}`
    : `${identity}のTwitter動画一覧・保存${page > 1 ? `｜${page}ページ` : ""}｜${SITE_NAME}`;
  const description = `${identity}のTwitter（X）動画を新しい順に紹介。この一覧の${d.totalCount ?? d.videos.length}件から、動画の再生・保存や元投稿の確認ができます。${d.facts?.tags.length ? `よく付くタグ：${d.facts.tags.slice(0, 3).map(tag => tag.name).join("、")}。` : ""}`;
  const images = d.videos.find(v => v.posterUrl)?.posterUrl;
  return { title: { absolute: title }, description, alternates: { canonical }, robots: { index: d.index, follow: true },
    openGraph: { type: "website", title, description, url: canonical, ...(images ? { images: [images] } : {}) },
    twitter: { card: "summary_large_image", title, description, ...(images ? { images: [images] } : {}) } };
}
export default async function AccountPage(props: Props) {
  const { d, page } = await readPage(props); if (!d) notFound();
  const base = `/accounts/${encodeURIComponent(d.canonicalKey)}`;
  const showActions = page === 1 && d.videos.length >= 2;
  let measuredVideos = 0;
  let featured: PublicVideo | undefined;
  if (showActions) {
    for (const video of d.videos) {
      const views = video.views;
      if (views == null || !Number.isFinite(views) || views < 0) continue;
      measuredVideos++;
      if (views > (featured?.views ?? 0)) featured = video;
    }
  }
  const handle = d.handle ? `@${d.handle}` : null;
  return <main style={{ maxWidth: 1120, margin: "0 auto", padding: 24 }}><SiteBrand /><Link href="/accounts">投稿者一覧</Link><h1>{d.name}のTwitter動画一覧</h1>{handle ? <p>{handle}</p> : null}<FollowButton accountKey={d.canonicalKey} />
    <p>掲載中の最新動画{d.totalCount ?? d.videos.length}件を新しい順に紹介。再生・保存や元投稿の確認ができます。</p>
    {page === 1 && d.profile && d.profile.total >= 2 ? <section className="public-author-profile" aria-labelledby="author-profile-heading">
      <h2 id="author-profile-heading">{d.name}の動画データ</h2>
      <dl>
        <div><dt>掲載動画</dt><dd>{profileNumber(d.profile.total)}件</dd></div>
        {profileDate(d.profile.latestAt) ? <div><dt>最新の投稿</dt><dd>{profileDate(d.profile.latestAt)}</dd></div> : null}
        {profileDate(d.profile.firstAt) && d.profile.firstAt !== d.profile.latestAt ? <div><dt>最も古い掲載動画</dt><dd>{profileDate(d.profile.firstAt)}</dd></div> : null}
        {d.profile.measured >= 2 ? <div><dt>Xでの表示回数（確認できた{d.profile.measured}件の合計）</dt><dd>{profileNumber(d.profile.viewsTotal)}回</dd></div> : null}
      </dl>
      {d.profile.months.length >= 2 ? <p>月ごとの投稿数：{d.profile.months.map(m => `${m.month.replace("-", "年")}月 ${m.count}件`).join("、")}。</p> : null}
      {d.topVideos?.length ? <><h3>Xで表示回数の多い動画</h3><ol className="public-author-top">{d.topVideos.map(({ video, views }) => <li key={video.id}>
        <PublicPostLink id={video.id} returnTo={base}>{Array.from(video.text?.replace(/https?:\/\/t\.co\/\S+/gi, " ").replace(/\s+/g, " ").trim() || "動画を見る").slice(0, 60).join("")}</PublicPostLink>（{profileNumber(views)}回）</li>)}</ol></> : null}
    </section> : null}
    {page === 1 ? <StructuredData data={{ "@context": "https://schema.org", "@graph": [
      { "@type": "BreadcrumbList", itemListElement: [
        { "@type": "ListItem", position: 1, name: SITE_NAME, item: PUBLIC_SITE + "/rising" },
        { "@type": "ListItem", position: 2, name: "投稿者一覧", item: PUBLIC_SITE + "/accounts" },
        { "@type": "ListItem", position: 3, name: d.name, item: PUBLIC_SITE + base }] },
      { "@type": "CollectionPage", name: `${d.name}のTwitter動画一覧`, url: PUBLIC_SITE + base, mainEntity: { "@type": "ItemList", numberOfItems: d.totalCount ?? d.videos.length,
        itemListElement: d.videos.slice(0, 24).map((v, i) => ({ "@type": "ListItem", position: i + 1, url: PUBLIC_SITE + "/p/" + v.id })) } }] }} /> : null}
    {showActions ? <nav className="public-author-actions" aria-label="動画を探す">
      <a href="#latest-videos">新着動画を見る</a>
      {measuredVideos >= 2 && featured ? <PublicPostLink id={featured.id} returnTo={base}>Xで表示回数が多い動画を見る（このページ内）</PublicPostLink> : null}
    </nav> : null}
    {d.facts?.tags.length ? <nav className="public-post-tags" aria-label="この投稿者の動画によく付くタグ">{showActions ? <span>よく付くタグ</span> : null}{d.facts.tags.map(tag => <Link key={tag.name} href={tagHref({ ...tag, active: true })}>{tag.name} {tag.count}件</Link>)}</nav> : null}
    {showActions ? <h2 id="latest-videos" style={{ scrollMarginTop: 96 }}>新着動画</h2> : null}
    <p>{page} / {d.totalPages}ページ</p><PublicVideoCards priorityCount={4} videos={d.videos} returnTo={page > 1 ? `${base}?page=${page}` : base} />
    <nav aria-label="投稿者の動画ページ" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
      {Array.from({ length: d.totalPages }, (_, i) => <Link key={i} href={i === 0 ? base : `${base}?page=${i + 1}`}
        aria-current={i + 1 === page ? "page" : undefined}>{i + 1}</Link>)}
    </nav></main>;
}
