import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import DedicatedRankingPage from "../../components/DedicatedRankingPage";
import { loadRankingPage } from "../../../lib/initial-ranking";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "24時間のTwitter動画ランキング・保存",
  description:
    "毎日入れ替わるTwitter（X）動画を紹介。新着とは違う掲載動画を探し、再生・保存や元投稿の確認ができます。",
  alternates: {
    canonical: "/ranking/daily"
  },
  robots: {
    index: true,
    follow: true,
    "max-image-preview": "large"
  },
  openGraph: {
    title: "24時間のTwitter動画ランキング・保存 | twizou",
    description:
      "毎日入れ替わるTwitter（X）動画を紹介。新着とは違う掲載動画を探し、再生・保存や元投稿の確認ができます。",
    url: "/ranking/daily",
    images: ["/twizou-share.png"]
  },
  twitter: {
    card: "summary_large_image",
    title: "24時間のTwitter動画ランキング・保存 | twizou",
    description:
      "毎日更新のX動画24時間ランキングです。",
    images: ["/twizou-share.png"]
  },
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
