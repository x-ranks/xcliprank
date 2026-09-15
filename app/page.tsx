import type { Metadata } from "next";
import Link from "next/link";
import RankingClient from "./components/RankingClient";
import StructuredData from "./components/StructuredData";
import { loadInitialRanking } from "../lib/initial-ranking";
import { rankingItemList, SITE_NAME, SITE_URL } from "../lib/seo";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
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

export default async function Home() {
  const initialPosts = await loadInitialRanking("trending");
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
        "/",
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
        <Link href="/" className="active" aria-current="page">新着</Link>
        <Link href="/ranking/daily">24時間</Link>
        <Link href="/ranking/weekly">週間</Link>
        <Link href="/reels">リール</Link>
      </nav>
      <RankingClient
        range="trending"
        initialPosts={initialPosts}
        fixedRange
      />
      <section className="seo-info" aria-labelledby="about-ranking">
        <h2 id="about-ranking">X動画ランキングについて</h2>
        <p>
          人気の動向は<Link href="/ranking/daily">24時間ランキング</Link>と
          <Link href="/ranking/weekly">週間ランキング</Link>から確認できます。
        </p>
      </section>
      <footer>
        <p>動画ファイル自体はすべてXのサービス上にあり、当サイトでは動画ファイルの保存・収集・再アップロードを行っていません。X上の元投稿を参照して表示しています。</p>
        <p>削除・非公開化された投稿は表示されなくなります。違法または権利侵害と思われる投稿は、<Link href="/removal-request">削除要請フォーム</Link>からお知らせください。</p>
      </footer>
    </main>
  );
}
