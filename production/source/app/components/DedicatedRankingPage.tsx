import RankingNavLink from "./RankingNavLink";
import SiteBrand from "./SiteBrand";
import { rankingHref } from "../../lib/ranking-pagination";
import Link from "next/link";
import type { RankingUpdate } from "../../lib/ranking-update";
import RankingClient, { type RankPost } from "./RankingClient";
import SiteFooter from "./SiteFooter";
import StructuredData from "./StructuredData";
import { rankingBreadcrumb, rankingItemList } from "../../lib/seo";
import { INITIAL_RANKING_COUNTS } from "../../lib/ranking-display";

type DedicatedRange = "daily" | "weekly";

const PAGE_COPY = {
  daily: {
    eyebrow: "DAILY RANKING",
    title: "24時間ランキング",
    description:
      "毎日入れ替わる動画を紹介！",
    seoTitle: "Twitter動画の24時間ランキング・保存",
    seoDescription:
      "直近24時間の動画に過去の選別動画を加え、新着ランキングとは異なる動画を紹介しています。"
  },
  weekly: {
    eyebrow: "WEEKLY RANKING",
    title: "週間ランキング",
    description:
      "直近1週間の人気動画を紹介！",
    seoTitle: "Twitter動画の週間ランキング・保存",
    seoDescription:
      "直近1週間の人気動画をランキング形式で表示しています。"
  }
} as const;

export default function DedicatedRankingPage({
  range,
  initialPosts,
  edition,
  initialUpdate
}: {
  range: DedicatedRange;
  initialPosts: RankPost[];
  edition?: string;
  initialUpdate?: RankingUpdate;
}) {
  const copy = PAGE_COPY[range];
  const path = `/ranking/${range}`;
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      rankingBreadcrumb(copy.title, path),
      rankingItemList(copy.seoTitle, path, initialPosts.slice(0, INITIAL_RANKING_COUNTS[range]))
    ]
  };

  return (
    <main>
      <StructuredData data={structuredData} />
      <header className="ranking-page-header">
        <SiteBrand />
        <h1 className="ranking-page-title">{copy.title}</h1>
        <p className="ranking-page-description">{copy.description}</p>
      </header>

      <nav className="ranking-page-nav" aria-label="ランキングを選択">
        <RankingNavLink href="/rising">急上昇</RankingNavLink>
        <RankingNavLink href={rankingHref("trending", edition)}>新着</RankingNavLink>
        <RankingNavLink
          href={rankingHref("daily", edition)}
          className={range === "daily" ? "active" : undefined}
          aria-current={range === "daily" ? "page" : undefined}
        >
          24時間
        </RankingNavLink>
        <RankingNavLink
          href={rankingHref("weekly", edition)}
          className={range === "weekly" ? "active" : undefined}
          aria-current={range === "weekly" ? "page" : undefined}
        >
          週間
        </RankingNavLink>
        <RankingNavLink href="/reels">リール</RankingNavLink>
        <RankingNavLink href="/download">動画保存</RankingNavLink>
      </nav>

      <RankingClient
        range={range}
        initialPosts={initialPosts}
        edition={edition}
        initialUpdate={initialUpdate}
        fixedRange
      />

      <section className="seo-info" aria-labelledby={`${range}-ranking-info`}>
        <h2 id={`${range}-ranking-info`}>{copy.seoTitle}</h2>
        <p>{copy.seoDescription}</p>
        <p className="seo-related-links">
          <Link prefetch={false} href={rankingHref("trending", edition)}>新着ランキング</Link>
          {range === "daily" ? (
            <Link prefetch={false} href={rankingHref("weekly", edition)}>週間ランキング</Link>
          ) : (
            <Link prefetch={false} href={rankingHref("daily", edition)}>24時間ランキング</Link>
          )}
        </p>
      </section>

      <SiteFooter />
    </main>
  );
}
