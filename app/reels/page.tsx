import type { Metadata } from "next";
import ReelsFeed from "./ReelsFeed";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "X動画リール",
  description:
    "Tier S〜Cの選別済みX動画を、縦スワイプのリール形式でランダムに楽しめます。",
  alternates: {
    canonical: "/reels",
  },
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    title: "X動画リール | X CLIP RANK",
    description:
      "選別済みのX動画を縦スワイプで連続再生。Tier S〜Cからランダムに表示します。",
    url: "/reels",
  },
  twitter: {
    card: "summary_large_image",
    title: "X動画リール | X CLIP RANK",
    description: "Tier S〜CのX動画をリール形式で楽しめます。",
  },
  other: {
    rating: "adult",
  },
};

export default function ReelsPage() {
  return <ReelsFeed />;
}
