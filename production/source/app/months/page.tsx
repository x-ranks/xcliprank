import SiteBrand from "../components/SiteBrand";
import type { Metadata } from "next";
import { readPublicMonths } from "../../lib/public-video-server";
import { profileNumber } from "../../lib/public-video-core";
import { monthHref, monthLabel } from "../../lib/month-pages";
export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const months = await readPublicMonths();
  return { title: "月別のTwitter動画ランキング一覧", robots: { index: months.length > 0, follow: true, "max-image-preview": "large" },
    alternates: { canonical: "/months" }, description: "twizouに掲載したTwitter（X）動画を投稿月ごとに集計。月ごとの人気動画ランキング、人気タグ、投稿者を確認できます。",
    openGraph: { title: "月別のTwitter動画ランキング一覧｜twizou", url: "/months", images: ["/twizou-share.png"] },
    twitter: { card: "summary_large_image", title: "月別のTwitter動画ランキング一覧｜twizou", images: ["/twizou-share.png"] } };
}
export default async function MonthsPage() {
  const months = await readPublicMonths();
  return <main style={{ maxWidth: 900, margin: "0 auto", padding: 24 }}><SiteBrand active="months" /><a href="/rising">急上昇ランキング</a>
    <h1>月別のTwitter動画ランキング</h1>
    <p>twizouに掲載した動画を、投稿された月ごとにまとめています。各月のページでは、Xでの表示回数が多い動画、人気のタグ、動画が多い投稿者を確認できます。</p>
    {months.length ? null : <p>現在表示できる月はありません。</p>}
    <ul>{months.map(m => <li key={m.month}><a href={monthHref(m.month)}>{monthLabel(m.month)}の人気動画</a>（{profileNumber(m.count)}件）</li>)}</ul></main>;
}
