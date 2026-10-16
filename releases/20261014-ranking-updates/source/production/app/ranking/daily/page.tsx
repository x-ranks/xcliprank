import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import DedicatedRankingPage from "../../components/DedicatedRankingPage";
import { loadRankingPage } from "../../../lib/initial-ranking";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "X動画 24時間ランキング",
  description:
    "A〜Sの選別動画を毎日ランダムな順序で紹介。新着ランキングと重複しない動画を探せる、X CLIP RANKの24時間ランキングです。",
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
      "A〜Sの選別動画を毎日ランダムな順序で紹介。新着ランキングと重複しない動画を探せる、X CLIP RANKの24時間ランキングです。",
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

export default async function DailyRankingPage({ searchParams }: { searchParams: Promise<{ edition?: string | string[] }> }) {
  const query = await searchParams;
  if (Array.isArray(query.edition)) notFound();
  const result = await loadRankingPage("daily", undefined, query.edition);
  if (result.status === 410) redirect("/ranking/daily");
  if (result.status === 400 || result.status === 404) notFound();
  if (result.status !== 200) throw Error("RANKING_LOAD_FAILED");
  const initialPosts = result.posts;

  return (
    <DedicatedRankingPage
      range="daily"
      key={result.edition}
      initialPosts={initialPosts}
      edition={result.edition}
      initialUpdate={result.update}
    />
  );
}
