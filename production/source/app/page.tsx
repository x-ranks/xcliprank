import RankingNavLink from "./components/RankingNavLink";
import SiteBrand from "./components/SiteBrand";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { parseRankingPage, newestPageHref, rankingHref } from "../lib/ranking-pagination";
import Link from "next/link";
import RankingClient from "./components/RankingClient";
import NewSinceVisit from "./components/NewSinceVisit";
import SiteFooter from "./components/SiteFooter";
import StructuredData from "./components/StructuredData";
import { loadRankingPage } from "../lib/initial-ranking";
import { rankingItemList, SITE_NAME, SITE_URL } from "../lib/seo";

export const dynamic = "force-dynamic";

const homeMetadata: Metadata = {
  title: {
    absolute: "Twitter動画ランキング・保存｜新着・24時間・週間｜twizou"
  },
  description:
    "Twitter（X）の動画を新着・24時間・週間ランキングで紹介。気になる動画の再生・保存や、投稿者・タグからの動画探しができます。",
  alternates: {
    canonical: "/"
  },
  robots: {
    index: true,
    follow: true,
    "max-image-preview": "large"
  },
  openGraph: {
    title: "Twitter動画ランキング・保存｜新着・24時間・週間｜twizou",
    description:
      "Twitter（X）の動画を新着・24時間・週間ランキングで紹介。動画の再生・保存や、投稿者・タグからの動画探しができます。",
    url: "/",
    images: [`${SITE_URL}/twizou-share.png`]
  },
  twitter: {
    card: "summary_large_image",
    title: "Twitter動画ランキング・保存｜新着・24時間・週間｜twizou",
    description:
      "Twitter（X）の動画ランキング。気になる動画を再生・保存し、投稿者やタグから探せます。",
    images: [`${SITE_URL}/twizou-share.png`]
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
  return { ...homeMetadata, ...(page > 1 ? { title: { absolute: `Twitter動画ランキング・保存｜新着 ${page}ページ｜twizou` } } : {}), metadataBase: null, alternates: { canonical }, openGraph: { ...homeMetadata.openGraph, url: canonical } };
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
      <header className="hero branded-page-header">
        <SiteBrand showSearch />
        <h1 className="ranking-page-title">新着ランキング</h1>
        <p>新着動画を紹介！</p>
      </header>
      <nav className="ranking-page-nav" aria-label="ランキングを選択">
        <RankingNavLink href="/rising">急上昇</RankingNavLink>
        <RankingNavLink href={rankingHref("trending")} className="active" aria-current="page">新着</RankingNavLink>
        <RankingNavLink href={rankingHref("daily")}>24時間</RankingNavLink>
        <RankingNavLink href={rankingHref("weekly")}>週間</RankingNavLink>
        <RankingNavLink href="/reels">リール</RankingNavLink>
        <RankingNavLink href="/download">動画保存</RankingNavLink>
      </nav>
      {page === 1 && <NewSinceVisit ids={initialPosts.map(post => String(post.x_post_id))} />}
      <RankingClient
        key={`${edition}:${page}`}
        range="trending"
        initialPosts={initialPosts}
        pagination={result.pagination}
        initialUpdate={result.update}
        fixedRange
      />
      <section className="seo-info" aria-labelledby="about-ranking">
        <h2 id="about-ranking">Twitter動画ランキングについて</h2>
        <p>
          人気の動向は<Link prefetch={false} href="/ranking/daily">24時間ランキング</Link>と
          <Link prefetch={false} href="/ranking/weekly">週間ランキング</Link>から確認できます。
        </p>
      </section>
      <SiteFooter />
    </main>
  );
}
