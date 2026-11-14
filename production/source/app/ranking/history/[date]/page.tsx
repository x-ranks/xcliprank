import SiteBrand from "../../../components/SiteBrand";
import SiteFooter from "../../../components/SiteFooter";
import StructuredData from "../../../components/StructuredData";
import PublicVideoCards from "../../../components/PublicVideoCards";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PUBLIC_SITE, profileNumber } from "../../../../lib/public-video-core";
import { SITE_NAME } from "../../../../lib/seo";
import { readPublicRankDay } from "../../../../lib/public-video-server";
import { rankDayHref, rankDayLabel } from "../../../../lib/rank-history-pages";
export const dynamic = "force-dynamic";
type Props = { params: Promise<{ date: string }> };
async function readPage(props: Props) { const { date } = await props.params; return readPublicRankDay(date); }
export async function generateMetadata(props: Props): Promise<Metadata> {
  const d = await readPage(props); if (!d) return {};
  const label = rankDayLabel(d.day), title = `${label}のTwitter動画24時間ランキング｜${SITE_NAME}`;
  const description = `${label}のtwizou 24時間ランキングの記録です。${d.entries.length}件の順位と、その日に複数の動画がランクインした投稿者を確認できます。`;
  const canonical = PUBLIC_SITE + rankDayHref(d.day), poster = d.entries.find(e => e.video.posterUrl)?.video.posterUrl;
  return { title: { absolute: title }, description, alternates: { canonical }, robots: { index: d.index, follow: true, "max-image-preview": "large" },
    openGraph: { title, description, url: canonical, ...(poster ? { images: [poster] } : {}) },
    twitter: { card: poster ? "summary_large_image" : "summary", title, description, ...(poster ? { images: [poster] } : {}) } };
}
export default async function RankDayPage(props: Props) {
  const d = await readPage(props); if (!d) notFound();
  const label = rankDayLabel(d.day), base = rankDayHref(d.day), hidden = d.recorded - d.entries.length;
  return <main style={{ maxWidth: 1120, margin: "0 auto", padding: 24 }}><SiteBrand active="ranking" /><a href="/ranking/history">過去のランキング一覧</a>
    <h1>{label}のTwitter動画24時間ランキング</h1>
    <p>{label}（日本時間）に、twizouの24時間ランキングに載っていた動画の記録です。順位は当日の最後に記録した時点のものです。{hidden > 0 ? `その後に見られなくなった動画${hidden}件は表示していません（順位は当時のまま）。` : ""}</p>
    <section className="public-author-profile" aria-labelledby="rank-day-data-heading">
      <h2 id="rank-day-data-heading">{label}のランキングデータ</h2>
      <dl>
        <div><dt>掲載中の動画</dt><dd>{profileNumber(d.entries.length)}件</dd></div>
        <div><dt>投稿者</dt><dd>{profileNumber(d.authorCount)}人</dd></div>
        {d.newEntries !== null ? <div><dt>前の記録日にはなかった動画</dt><dd>{profileNumber(d.newEntries)}件</dd></div> : null}
        {d.measured >= 2 ? <div><dt>Xでの表示回数（確認できた{profileNumber(d.measured)}件の合計）</dt><dd>{profileNumber(d.viewsTotal)}回</dd></div> : null}
      </dl>
      {d.topAuthors.length ? <><h3>この日に複数の動画がランクインした投稿者</h3><ul className="public-author-top">{d.topAuthors.map(a => <li key={a.key}><a href={`/accounts/${encodeURIComponent(a.key)}`}>{a.name}</a>（{a.count}本・最高{a.best}位）</li>)}</ul></> : null}
    </section>
    <StructuredData data={{ "@context": "https://schema.org", "@graph": [
      { "@type": "BreadcrumbList", itemListElement: [
        { "@type": "ListItem", position: 1, name: SITE_NAME, item: PUBLIC_SITE + "/rising" },
        { "@type": "ListItem", position: 2, name: "過去のランキング", item: PUBLIC_SITE + "/ranking/history" },
        { "@type": "ListItem", position: 3, name: label, item: PUBLIC_SITE + base }] },
      { "@type": "CollectionPage", name: `${label}のTwitter動画24時間ランキング`, url: PUBLIC_SITE + base, mainEntity: { "@type": "ItemList", numberOfItems: d.entries.length,
        itemListElement: d.entries.map(e => ({ "@type": "ListItem", position: e.rank, url: PUBLIC_SITE + "/p/" + e.video.id })) } }] }} />
    <h2>{label}の順位</h2>
    {d.entries.length ? <PublicVideoCards priorityCount={4} videos={d.entries.map(e => e.video)} ranks={d.entries.map(e => e.rank)} returnTo="/ranking/daily" nativeNavigation /> : <p>この日の動画は、現在すべて表示できません。</p>}
    <nav aria-label="前後の日" style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 16 }}>
      {d.prev ? <a href={rankDayHref(d.prev)}>← {rankDayLabel(d.prev)}</a> : null}
      {d.next ? <a href={rankDayHref(d.next)}>{rankDayLabel(d.next)} →</a> : null}
      <a href="/ranking/daily">現在の24時間ランキング</a><a href="/ranking/history">過去のランキング一覧</a>
    </nav><SiteFooter /></main>;
}
