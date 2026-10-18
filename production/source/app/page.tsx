import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { parseRankingPage, newestPageHref, rankingHref } from "../lib/ranking-pagination";
import Link from "next/link";
import RankingClient from "./components/RankingClient";
import SiteFooter from "./components/SiteFooter";
import StructuredData from "./components/StructuredData";
import { loadRankingPage } from "../lib/initial-ranking";
import { rankingItemList, SITE_NAME, SITE_URL } from "../lib/seo";

export const dynamic = "force-dynamic";

const homeMetadata: Metadata = {
  title: {
    absolute: "X動画ランキング｜新着・24時間・週間の人気動画"
  },
  description:
    "Xに投稿された動画を独自基準で選出し、新着・24時間・週間ランキングで紹介。軽量なサムネイルから気になる投稿をすぐに確認できます。",
  alternates: {
    canonical: "/"
  },
  robots: {
    index: true,
    follow: true
  },
  openGraph: {
    title: "X動画ランキング｜新着・24時間・週間の人気動画",
    description:
      "Xに投稿された動画を独自基準で選出し、新着・24時間・週間ランキングで紹介します。",
    url: "/"
  },
  twitter: {
    card: "summary_large_image",
    title: "X動画ランキング｜新着・24時間・週間の人気動画",
    description:
      "Xに投稿された動画を新着・24時間・週間ランキングで紹介します。"
  },
  other: {
    rating: "adult"
  }
};

type Search = Promise<{ page?: string | string[]; edition?: string | string[] }>;
export async function generateMetadata({ searchParams }: { searchParams: Search }): Promise<Metadata> {
  const query = await searchParams;
  let page = 1;
  try { page = parseRankingPage(typeof query.page === "string" ? query.page : query.page ? "invalid" : undefined); }
  catch { return { ...homeMetadata, robots: { index: false, follow: true } }; }
  const canonical = SITE_URL + newestPageHref(page);
  // Next 15 can discard a root URL's query when metadataBase is set.
  // This page supplies absolute URLs, so resolve them without the inherited base.
  return { ...homeMetadata, metadataBase: null, alternates: { canonical }, openGraph: { ...homeMetadata.openGraph, url: canonical } };
}
export default async function Home({ searchParams }: { searchParams: Search }) {
  const query = await searchParams;
  let page: number;
  try { page = parseRankingPage(typeof query.page === "string" ? query.page : query.page ? "invalid" : undefined); }
  catch { notFound(); }
  if (Array.isArray(query.edition)) notFound();
  const result = await loadRankingPage("trending", page, query.edition);
  if (result.status === 410) redirect("/");
  if (result.status === 400 || result.status === 404) notFound();
  if (result.status !== 200 || !result.pagination) throw Error("NEWEST_RANKING_LOAD_FAILED");
  const initialPosts = result.posts;
  const edition = result.edition;
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        name: SITE_NAME,
        url: SITE_URL,
        inLanguage: "ja-JP",
        description:
          "Xに投稿された動画を新着・24時間・週間ランキングで紹介するサイト"
      },
      rankingItemList(
        "X動画 新着ランキング",
        newestPageHref(page),
        initialPosts
      )
    ]
  };

  return (
    <main>
      <StructuredData data={structuredData} />
      <header className="hero">
        <h1 className="site-title"><span>X</span> CLIP RANK</h1>
        <p>Xに投稿された動画をランキング形式で表示</p>
      </header>
      <nav className="ranking-page-nav" aria-label="ランキングを選択">
        <Link href={rankingHref("trending", edition)} className="active" aria-current="page">新着</Link>
        <Link href={rankingHref("daily", edition)}>24時間</Link>
        <Link href={rankingHref("weekly", edition)}>週間</Link>
        <Link href="/reels">リール</Link>
        <Link href="/download">動画保存</Link>
      </nav>
      <RankingClient
        key={`${edition}:${page}`}
        range="trending"
        initialPosts={initialPosts}
        pagination={result.pagination}
        initialUpdate={result.update}
        fixedRange
      />
      <section className="seo-info" aria-labelledby="about-ranking">
        <h2 id="about-ranking">X動画ランキングについて</h2>
        <p>
          人気の動向は<Link href="/ranking/daily">24時間ランキング</Link>と
          <Link href="/ranking/weekly">週間ランキング</Link>から確認できます。
        </p>
      </section>
      <SiteFooter />
    </main>
  );
}
