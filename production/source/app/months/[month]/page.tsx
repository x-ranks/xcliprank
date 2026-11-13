import SiteBrand from "../../components/SiteBrand";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import PublicVideoCards from "../../components/PublicVideoCards";
import StructuredData from "../../components/StructuredData";
import { PUBLIC_SITE, profileNumber, tagHref } from "../../../lib/public-video-core";
import { SITE_NAME } from "../../../lib/seo";
import { monthHref, monthLabel } from "../../../lib/month-pages";
import { readPublicMonth, readPublicLabels } from "../../../lib/public-video-server";
export const dynamic = "force-dynamic";
type Props = { params: Promise<{ month: string }> };
async function readPage(props: Props) { const { month } = await props.params; return readPublicMonth(month); }
export async function generateMetadata(props: Props): Promise<Metadata> {
  const d = await readPage(props); if (!d) return {};
  const label = monthLabel(d.month), kind = d.byViews ? "人気ランキング" : "一覧";
  const title = `${label}のTwitter動画${kind}｜${SITE_NAME}`;
  const description = `${label}に投稿されたTwitter（X）動画${d.total}件を集計。${d.byViews ? "Xでの表示回数が多い順に紹介し、" : ""}人気のタグと投稿者も確認できます。`;
  const canonical = PUBLIC_SITE + monthHref(d.month), poster = d.ranked.find(v => v.posterUrl)?.posterUrl;
  return { title: { absolute: title }, description, alternates: { canonical }, robots: { index: d.index, follow: true, "max-image-preview": "large" },
    openGraph: { title, description, url: canonical, ...(poster ? { images: [poster] } : {}) },
    twitter: { card: poster ? "summary_large_image" : "summary", title, description, ...(poster ? { images: [poster] } : {}) } };
}
export default async function MonthPage(props: Props) {
  const d = await readPage(props); if (!d) notFound();
  const base = monthHref(d.month), label = monthLabel(d.month);
  const available = (await readPublicLabels().catch(() => [])).filter(tag => tag.index && tag.count > 0);
  const tags = d.tags.filter(tag => available.some(a => a.name === tag.name));
  return <main style={{ maxWidth: 1120, margin: "0 auto", padding: 24 }}><SiteBrand /><a href="/months">月別一覧</a>
    <h1>{label}のTwitter動画{d.byViews ? "人気ランキング" : "一覧"}</h1>
    <p>{label}に投稿された掲載動画は{profileNumber(d.total)}件・{profileNumber(d.authorCount)}投稿者。{d.byViews ? "Xでの表示回数が多い順に紹介します。" : "新しい順に紹介します。"}動画を再生・保存し、元投稿を確認できます。</p>
    <section className="public-author-profile" aria-labelledby="month-data-heading">
      <h2 id="month-data-heading">{label}の動画データ</h2>
      <dl>
        <div><dt>掲載動画</dt><dd>{profileNumber(d.total)}件</dd></div>
        <div><dt>投稿者</dt><dd>{profileNumber(d.authorCount)}人</dd></div>
        {d.byViews ? <div><dt>Xでの表示回数（確認できた{profileNumber(d.measured)}件の合計）</dt><dd>{profileNumber(d.viewsTotal)}回</dd></div> : null}
        {d.byViews ? <div><dt>1本あたりの平均表示回数</dt><dd>{profileNumber(Math.round(d.viewsTotal / d.measured))}回</dd></div> : null}
      </dl>
      {d.topAuthors.length ? <><h3>この月に動画が多い投稿者</h3><ul className="public-author-top">{d.topAuthors.map(a => <li key={a.key}><a href={`/accounts/${encodeURIComponent(a.key)}`}>{a.name}</a>（{a.count}件）</li>)}</ul></> : null}
    </section>
    <StructuredData data={{ "@context": "https://schema.org", "@graph": [
      { "@type": "BreadcrumbList", itemListElement: [
        { "@type": "ListItem", position: 1, name: SITE_NAME, item: PUBLIC_SITE + "/rising" },
        { "@type": "ListItem", position: 2, name: "月別", item: PUBLIC_SITE + "/months" },
        { "@type": "ListItem", position: 3, name: label, item: PUBLIC_SITE + base }] },
      { "@type": "CollectionPage", name: `${label}のTwitter動画${d.byViews ? "人気ランキング" : "一覧"}`, url: PUBLIC_SITE + base, mainEntity: { "@type": "ItemList", numberOfItems: d.ranked.length,
        itemListElement: d.ranked.map((v, i) => ({ "@type": "ListItem", position: i + 1, url: PUBLIC_SITE + "/p/" + v.id })) } }] }} />
    <h2>{d.byViews ? `${label}のXで表示回数が多い動画` : `${label}の新着動画`}</h2>
    <PublicVideoCards priorityCount={4} videos={d.ranked} returnTo={base} nativeNavigation />
    {tags.length ? <><h2>{label}に多いタグ</h2><nav className="public-post-tags" aria-label="この月に多いタグ">{tags.map(tag => <a key={tag.id} href={tagHref({ ...tag, active: true })}>{tag.name} {tag.count}件</a>)}</nav></> : null}
    <nav aria-label="前後の月" style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 16 }}>
      {d.prev ? <a href={monthHref(d.prev)}>← {monthLabel(d.prev)}</a> : null}
      {d.next ? <a href={monthHref(d.next)}>{monthLabel(d.next)} →</a> : null}
      <a href="/months">月別一覧</a>
    </nav></main>;
}
