import SiteBrand from "../../components/SiteBrand";
import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import PublicVideoCards from "../../components/PublicVideoCards";
import PublicPostLink from "../../components/PublicPostLink";
import StructuredData from "../../components/StructuredData";
import { PUBLIC_SITE, profileDate, profileNumber, tagHref } from "../../../lib/public-video-core";
import { SITE_NAME } from "../../../lib/seo";
import { readPublicTag, readPublicLabels } from "../../../lib/public-video-server";
export const dynamic = "force-dynamic";
type Props = { params: Promise<{ name: string }>; searchParams?: Promise<{ page?: string | string[] }> };
async function readPage(props: Props) {
  const { name } = await props.params, search = await props.searchParams;
  const raw = search?.page;
  if (raw !== undefined && (typeof raw !== "string" || !/^[1-9]\d{0,3}$/.test(raw))) notFound();
  const page = raw === undefined ? 1 : Number(raw);
  return { d: await readPublicTag(name, page), page, name };
}
export async function generateMetadata(props: Props): Promise<Metadata> {
  const { d, page } = await readPage(props);
  if (!d) return {};
  const title = `${d.label.name}のTwitter動画一覧・保存${page > 1 ? `｜${page}ページ` : ""}｜${SITE_NAME}`;
  const description = `${d.label.name}タグのTwitter（X）動画${d.totalCount ?? d.videos.length}件を紹介。${d.facts?.authorCount ? `${d.facts.authorCount}投稿者の掲載動画から、` : ""}動画の再生・保存や元投稿の確認ができます。`;
  const canonical = PUBLIC_SITE + tagHref(d.label) + (page > 1 ? `?page=${page}` : "");
  const poster = d.videos.find(video => video.posterUrl)?.posterUrl;
  return { title: { absolute: title }, description, alternates: { canonical }, robots: { index: d.index, follow: true, "max-image-preview": "large" },
    openGraph: { title, description, url: canonical, ...(poster ? { images: [poster] } : {}) },
    twitter: { card: poster ? "summary_large_image" : "summary", title, description, ...(poster ? { images: [poster] } : {}) } };
}
export default async function TagPage(props: Props) {
  const { name, d, page } = await readPage(props); if (!d) notFound();
  const base = tagHref(d.label);
  // App Router may provide a decoded name or the percent-encoded route segment.
  // Comparing the encoded segment to the display name redirects to the same URL forever.
  const sameRoute = (value: string) => value.replace(/%[0-9a-f]{2}/gi, escape => escape.toUpperCase());
  if (name.normalize("NFC") !== d.label.name && sameRoute(name) !== sameRoute(encodeURIComponent(d.label.name)))
    permanentRedirect(base + (page > 1 ? `?page=${page}` : ""));
  const availableTags = (await readPublicLabels().catch(() => [])).filter(tag => tag.index && tag.count > 0 && tag.name !== d.label.name);
  const relatedTags = d.facts ? d.facts.tags.filter(tag => availableTags.some(available => available.name === tag.name)) : [];
  const returnTo = base + (page > 1 ? `?page=${page}` : "");
  return <main style={{ maxWidth: 1120, margin: "0 auto", padding: 24 }}><SiteBrand /><a href="/tags">タグ一覧</a><h1>{d.label.name}のTwitter動画一覧</h1>
    <p>{d.label.name}タグの掲載動画{d.totalCount ?? d.videos.length}件{d.facts?.authorCount ? `・${d.facts.authorCount}投稿者` : ""}。動画を再生・保存し、元投稿を確認できます。</p>
    {page === 1 && d.profile && d.profile.total >= 3 ? <section className="public-author-profile" aria-labelledby="tag-profile-heading">
      <h2 id="tag-profile-heading">{d.label.name}タグの動画データ</h2>
      <dl>
        <div><dt>掲載動画</dt><dd>{profileNumber(d.profile.total)}件</dd></div>
        {d.facts?.authorCount ? <div><dt>投稿者</dt><dd>{profileNumber(d.facts.authorCount)}人</dd></div> : null}
        {profileDate(d.profile.latestAt) ? <div><dt>最新の投稿</dt><dd>{profileDate(d.profile.latestAt)}</dd></div> : null}
        {d.profile.measured >= 2 ? <div><dt>Xでの表示回数（確認できた{d.profile.measured}件の合計）</dt><dd>{profileNumber(d.profile.viewsTotal)}回</dd></div> : null}
      </dl>
      {d.profile.months.length >= 2 ? <p>月ごとの投稿数：{d.profile.months.map(m => `${m.month.replace("-", "年")}月 ${m.count}件`).join("、")}。</p> : null}
      {d.topAuthors?.length ? <><h3>このタグの動画が多い投稿者</h3><ul className="public-author-top">{d.topAuthors.map(author => <li key={author.key}>
        <a href={`/accounts/${encodeURIComponent(author.key)}`}>{author.name}</a>（{author.count}件）</li>)}</ul></> : null}
      {d.topVideos?.length ? <><h3>Xで表示回数の多い動画</h3><ol className="public-author-top">{d.topVideos.map(({ video, views }) => <li key={video.id}>
        <PublicPostLink id={video.id} returnTo={base}>{Array.from(video.text?.replace(/https?:\/\/t\.co\/\S+/gi, " ").replace(/\s+/g, " ").trim() || "動画を見る").slice(0, 60).join("")}</PublicPostLink>（{profileNumber(views)}回）</li>)}</ol></> : null}
    </section> : null}
    {page === 1 ? <StructuredData data={{ "@context": "https://schema.org", "@graph": [
      { "@type": "BreadcrumbList", itemListElement: [
        { "@type": "ListItem", position: 1, name: SITE_NAME, item: PUBLIC_SITE + "/rising" },
        { "@type": "ListItem", position: 2, name: d.label.name, item: PUBLIC_SITE + base }] },
      { "@type": "CollectionPage", name: `${d.label.name}のTwitter動画一覧`, url: PUBLIC_SITE + base, mainEntity: { "@type": "ItemList", numberOfItems: d.totalCount ?? d.videos.length,
        itemListElement: d.videos.slice(0, 24).map((v, i) => ({ "@type": "ListItem", position: i + 1, url: PUBLIC_SITE + "/p/" + v.id })) } }] }} /> : null}
    <p>{d.totalCount}件中 {page} / {d.totalPages}ページ</p>
    {d.videos.length ? <PublicVideoCards priorityCount={4} videos={d.videos} returnTo={returnTo} nativeNavigation /> : <p>現在掲載できる動画はありません。</p>}
    {relatedTags.length ? <nav className="public-post-tags" aria-label="一緒に付けられているタグ">{relatedTags.map(tag => <a key={tag.id} href={tagHref({ ...tag, active: true })}>{tag.name} {tag.count}件</a>)}</nav> : null}
    <nav aria-label="タグの動画ページ" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
      {Array.from({ length: d.totalPages }, (_, i) => <a key={i} href={i === 0 ? base : `${base}?page=${i + 1}`}
        aria-current={i + 1 === page ? "page" : undefined}>{i + 1}</a>)}
    </nav></main>;
}
