import type { Metadata } from "next";
import ReelsFeed from "./ReelsFeed";
import StructuredData from "../components/StructuredData";
import { rankingBreadcrumb, SITE_URL } from "../../lib/seo";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "X動画リール",
  description:
    "選別済みのX動画を縦スワイプで連続再生。ランキングとは違う動画をランダムに探せる、X CLIP RANKのリールです。",
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
      "選別済みのX動画を縦スワイプで連続再生。ランキングとは違う動画をランダムに探せます。",
    url: "/reels",
  },
  twitter: {
    card: "summary_large_image",
    title: "X動画リール | X CLIP RANK",
    description: "選別済みのX動画を、縦スワイプのリール形式で楽しめます。",
  },
  other: {
    rating: "adult",
  },
};

export default function ReelsPage() {
  return (
    <>
      <StructuredData data={{
        "@context": "https://schema.org",
        "@graph": [
          {
            "@type": "WebPage",
            "@id": `${SITE_URL}/reels#webpage`,
            url: `${SITE_URL}/reels`,
            name: "X動画リール | X CLIP RANK",
            description: "選別済みのX動画を縦スワイプで連続再生できます。",
            inLanguage: "ja-JP",
            isFamilyFriendly: false,
            breadcrumb: { "@id": `${SITE_URL}/reels#breadcrumb` }
          },
          rankingBreadcrumb("X動画リール", "/reels")
        ]
      }} />
      <ReelsFeed />
    </>
  );
}
