import SiteBrand from "../../components/SiteBrand";
import SiteFooter from "../../components/SiteFooter";
import type { Metadata } from "next";
import { readPublicRankDays } from "../../../lib/public-video-server";
import { rankDayHref, rankDayLabel } from "../../../lib/rank-history-pages";
export const dynamic = "force-dynamic";
const TITLE = "過去のTwitter動画24時間ランキング（日付別）";
export async function generateMetadata(): Promise<Metadata> {
  const days = await readPublicRankDays();
  const description = "twizouの24時間ランキングを日付ごとに記録しています。過去の日のランキングと、その日に多くランクインした投稿者を確認できます。";
  return { title: TITLE, description, alternates: { canonical: "/ranking/history" }, robots: { index: days.length >= 2, follow: true },
    openGraph: { title: `${TITLE}｜twizou`, description, url: "/ranking/history", images: ["/twizou-share.png"] },
    twitter: { card: "summary_large_image", title: `${TITLE}｜twizou`, description, images: ["/twizou-share.png"] } };
}
export default async function RankHistoryHub() {
  const days = await readPublicRankDays();
  const months = new Map<string, typeof days>();
  for (const d of days) { const m = d.day.slice(0, 7); months.set(m, [...(months.get(m) ?? []), d]); }
  return <main style={{ maxWidth: 900, margin: "0 auto", padding: 24 }}><SiteBrand active="ranking" />
    <nav className="ranking-page-nav" aria-label="ランキングを選択"><a href="/ranking/daily">24時間</a><a href="/ranking/weekly">週間</a><a href="/ranking/30days">30日</a><a href="/ranking/all">全期間</a><a href="/ranking/history" className="active" aria-current="page">過去</a></nav>
    <h1>{TITLE}</h1>
    <p>twizouの24時間ランキングを、日付ごとに記録しています（日本時間）。各日のページでは、その日の順位、初めてランクインした動画の数、複数の動画がランクインした投稿者を確認できます。</p>
    {days.length ? null : <p>記録はまだありません。記録を始めた日から、1日ごとに増えていきます。</p>}
    {[...months.entries()].map(([month, list]) => <section key={month}><h2>{Number(month.slice(0, 4))}年{Number(month.slice(5))}月</h2>
      <ul>{list.map(d => <li key={d.day}><a href={rankDayHref(d.day)}>{rankDayLabel(d.day)}のランキング</a>（{d.count}件）</li>)}</ul></section>)}
    <SiteFooter /></main>;
}
