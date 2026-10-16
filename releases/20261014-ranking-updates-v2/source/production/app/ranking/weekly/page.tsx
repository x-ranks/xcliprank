import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import DedicatedRankingPage from "../../components/DedicatedRankingPage";
import { loadRankingPage } from "../../../lib/initial-ranking";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "X動画 週間ランキング",
  description:
    "直近1週間のX動画をランキング形式で紹介。新着・24時間ランキングとあわせて、今週の人気動画を探せます。",
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
      "直近1週間のX動画を紹介する週間ランキングです。"
  },
  other: {
    rating: "adult"
  }
};

export default async function WeeklyRankingPage({ searchParams }: { searchParams: Promise<{ edition?: string | string[] }> }) {
  const query = await searchParams;
  if (Array.isArray(query.edition)) notFound();
  const result = await loadRankingPage("weekly", undefined, query.edition);
  if (result.status === 410) redirect("/ranking/weekly");
  if (result.status === 400 || result.status === 404) notFound();
  if (result.status !== 200) throw Error("RANKING_LOAD_FAILED");
  const initialPosts = result.posts;

  return (
    <DedicatedRankingPage
      range="weekly"
      key={result.edition}
      initialPosts={initialPosts}
      edition={result.edition}
      initialUpdate={result.update}
    />
  );
}
