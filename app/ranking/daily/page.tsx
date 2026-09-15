import type { Metadata } from "next";
import DedicatedRankingPage from "../../components/DedicatedRankingPage";
import { loadInitialRanking } from "../../../lib/initial-ranking";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "X動画 24時間ランキング",
  description:
    "直近24時間の人気動画をランキング形式で紹介。毎日更新のX動画ランキングです。",
  alternates: {
    canonical: "/ranking/daily"
  },
  robots: {
    index: true,
    follow: true
  },
  openGraph: {
    title: "X動画 24時間ランキング | X CLIP RANK",
    description:
      "直近24時間の人気動画をランキング形式で紹介します。",
    url: "/ranking/daily"
  },
  twitter: {
    card: "summary_large_image",
    title: "X動画 24時間ランキング | X CLIP RANK",
    description:
      "毎日更新のX動画24時間ランキングです。"
  },
  other: {
    rating: "adult"
  }
};

export default async function DailyRankingPage() {
  const initialPosts = await loadInitialRanking("daily");

  return (
    <DedicatedRankingPage
      range="daily"
      initialPosts={initialPosts}
    />
  );
}
