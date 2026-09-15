import type { Metadata } from "next";
import DedicatedRankingPage from "../../components/DedicatedRankingPage";
import { loadInitialRanking } from "../../../lib/initial-ranking";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "X動画 週間ランキング",
  description:
    "直近1週間の人気動画をランキング形式で紹介。毎週更新のX動画ランキングです。",
  alternates: {
    canonical: "/ranking/weekly"
  },
  robots: {
    index: true,
    follow: true
  },
  openGraph: {
    title: "X動画 週間ランキング | X CLIP RANK",
    description:
      "直近1週間の人気動画をランキング形式で紹介します。",
    url: "/ranking/weekly"
  },
  twitter: {
    card: "summary_large_image",
    title: "X動画 週間ランキング | X CLIP RANK",
    description:
      "毎週更新のX動画週間ランキングです。"
  },
  other: {
    rating: "adult"
  }
};

export default async function WeeklyRankingPage() {
  const initialPosts = await loadInitialRanking("weekly");

  return (
    <DedicatedRankingPage
      range="weekly"
      initialPosts={initialPosts}
    />
  );
}
