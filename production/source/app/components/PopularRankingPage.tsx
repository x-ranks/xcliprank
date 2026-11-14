import SiteBrand from "./SiteBrand";
import SiteFooter from "./SiteFooter";
import StructuredData from "./StructuredData";
import PublicVideoCards from "./PublicVideoCards";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PUBLIC_SITE, profileNumber } from "../../lib/public-video-core";
import { SITE_NAME } from "../../lib/seo";
import { monthHref, monthLabel } from "../../lib/month-pages";
import { readPublicPopular } from "../../lib/public-video-server";

export type PopularRange = "30days" | "all";
const COPY = {
  "30days": { path: "/ranking/30days", short: "直近30日", title: "直近30日のTwitter動画人気ランキング", scope: "直近30日に投稿された" },
  all: { path: "/ranking/all", short: "全期間", title: "全期間のTwitter動画人気ランキング", scope: "これまでに掲載した" },
} as const;
const jstDay = (iso: string | null) => { const t = iso ? Date.parse(iso) : NaN; if (!Number.isFinite(t)) return null; const d = new Date(t + 9 * 3600000); return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日`; };

export async function popularMetadata(range: PopularRange): Promise<Metadata> {
  const d = await readPublicPopular(range); if (!d) return {};
  const c = COPY[range], title = `${c.title}【Xの表示回数順】｜${SITE_NAME}`;
  const description = `${c.scope}Twitter（X）動画${profileNumber(d.total)}件を集計。Xでの表示回数が多い順に最大${d.ranked.length}件を紹介し、動画が人気の投稿者も確認できます。`;
  const canonical = PUBLIC_SITE + c.path, poster = d.ranked.find(v => v.posterUrl)?.posterUrl;
  return { title: { absolute: title }, description, alternates: { canonical }, robots: { index: d.index, follow: true, "max-image-preview": "large" },
    openGraph: { title, description, url: canonical, ...(poster ? { images: [poster] } : {}) },
    twitter: { card: poster ? "summary_large_image" : "summary", title, description, ...(poster ? { images: [poster] } : {}) } };
}

export default async function PopularRankingPage({ range }: { range: PopularRange }) {
  const d = await readPublicPopular(range); if (!d) notFound();
  const c = COPY[range], hasData = d.measured > 0;
  const period = range === "all" ? [jstDay(d.firstAt), jstDay(d.latestAt)].filter(Boolean).join("〜") : "";
  const tabs: [string, string, boolean][] = [["/ranking/daily", "24時間", false], ["/ranking/weekly", "週間", false], ["/ranking/30days", "30日", range === "30days"], ["/ranking/all", "全期間", range === "all"], ["/ranking/history", "過去", false]];
  return <main style={{ maxWidth: 1120, margin: "0 auto", padding: 24 }}>
    <SiteBrand active="ranking" />
    <nav className="ranking-page-nav" aria-label="ランキングを選択">{tabs.map(([href, label, active]) => <a key={href} href={href} className={active ? "active" : undefined} aria-current={active ? "page" : undefined}>{label}</a>)}</nav>
    <h1>{c.title}</h1>
    <p>{c.scope}掲載動画{profileNumber(d.total)}件・{profileNumber(d.authorCount)}投稿者のうち、Xでの表示回数が多い動画を順に紹介します。{period ? `（掲載期間：${period}）` : ""}表示回数は、twizouが記録したXでの数値で、確認できた{profileNumber(d.measured)}件が対象です。</p>
    {hasData ? <section className="public-author-profile" aria-labelledby="popular-data-heading">
      <h2 id="popular-data-heading">{c.short}の動画データ</h2>
      <dl>
        <div><dt>掲載動画</dt><dd>{profileNumber(d.total)}件</dd></div>
        <div><dt>投稿者</dt><dd>{profileNumber(d.authorCount)}人</dd></div>
        <div><dt>Xでの表示回数（確認できた{profileNumber(d.measured)}件の合計）</dt><dd>{profileNumber(d.viewsTotal)}回</dd></div>
        <div><dt>1本あたりの平均表示回数</dt><dd>{profileNumber(d.average)}回</dd></div>
        <div><dt>表示回数の中央値</dt><dd>{profileNumber(d.median)}回</dd></div>
      </dl>
    </section> : null}
    <StructuredData data={{ "@context": "https://schema.org", "@graph": [
      { "@type": "BreadcrumbList", itemListElement: [
        { "@type": "ListItem", position: 1, name: SITE_NAME, item: PUBLIC_SITE + "/rising" },
        { "@type": "ListItem", position: 2, name: "ランキング", item: PUBLIC_SITE + "/ranking/daily" },
        { "@type": "ListItem", position: 3, name: c.short, item: PUBLIC_SITE + c.path }] },
      { "@type": "CollectionPage", name: c.title, url: PUBLIC_SITE + c.path, mainEntity: { "@type": "ItemList", numberOfItems: d.ranked.length,
        itemListElement: d.ranked.map((v, i) => ({ "@type": "ListItem", position: i + 1, url: PUBLIC_SITE + "/p/" + v.id })) } }] }} />
    <h2>Xで表示回数が多い動画 TOP{d.ranked.length}</h2>
    {d.ranked.length ? <PublicVideoCards priorityCount={4} videos={d.ranked} returnTo={c.path} nativeNavigation ranked /> : <p>この期間に、表示回数を確認できた動画はまだありません。</p>}
    {d.topAuthors.length ? <section aria-labelledby="popular-authors-heading">
      <h2 id="popular-authors-heading">表示回数の合計が多い投稿者</h2>
      <ol className="public-author-top">{d.topAuthors.map(a => <li key={a.key}><a href={`/accounts/${encodeURIComponent(a.key)}`}>{a.name}</a>（動画{profileNumber(a.count)}件・合計{profileNumber(a.views)}回）</li>)}</ol>
    </section> : null}
    {d.months.length ? <section aria-labelledby="popular-months-heading">
      <h2 id="popular-months-heading">月ごとの動画数と表示回数</h2>
      <ul className="public-author-top">{d.months.map(m => <li key={m.month}><a href={monthHref(m.month)}>{monthLabel(m.month)}</a>（動画{profileNumber(m.count)}件・表示回数の合計{profileNumber(m.views)}回）</li>)}</ul>
    </section> : null}
    <section className="seo-info" aria-labelledby="popular-faq-heading">
      <h2 id="popular-faq-heading">このランキングについて</h2>
      <div className="seo-faq">
        <details><summary>どうやって順位を決めていますか？</summary><p>twizouに掲載している動画のうち、Xでの表示回数をtwizouが記録できたものを、多い順に並べています。{range === "30days" ? "対象は、直近30日に投稿された動画です。" : "対象は、これまでに掲載したすべての動画です。"}</p></details>
        <details><summary>表示回数はいつの数値ですか？</summary><p>twizouが動画の情報を記録した時点でのXでの表示回数です。Xでの現在の数値とは異なることがあります。</p></details>
        <details><summary>24時間・週間ランキングとの違いは？</summary><p>24時間・週間ランキングは、直近の動画を中心に、人気やtwizouでの評価をもとに選んでいます。このページは、Xでの表示回数だけで並べています。</p></details>
        <details><summary>動画を保存できますか？</summary><p>権利者が保存を許可した動画だけを保存してください。手順は<a href="/download">動画保存のページ</a>、条件は<a href="/download-policy">保存ポリシー</a>で確認できます。</p></details>
      </div>
      <p className="seo-related-links"><a href="/ranking/daily">24時間ランキング</a><a href="/ranking/weekly">週間ランキング</a><a href="/months">月別ランキング</a><a href="/accounts">投稿者一覧</a></p>
    </section>
    <SiteFooter />
  </main>;
}
