import { rankingHref } from "../../lib/ranking-pagination";
import Link from "next/link";
import type { RankingUpdate } from "../../lib/ranking-update";
import RankingClient, { type RankPost } from "./RankingClient";
import StructuredData from "./StructuredData";
import { rankingBreadcrumb, rankingItemList } from "../../lib/seo";

type DedicatedRange = "daily" | "weekly";

const PAGE_COPY = {
  daily: {
    eyebrow: "DAILY RANKING",
    title: "24時間ランキング",
    description:
      "直近24時間の人気動画をランキング形式で表示します。",
    seoTitle: "X動画の24時間ランキング",
    seoDescription:
      "直近24時間の人気動画をランキング形式で表示しています。"
  },
  weekly: {
    eyebrow: "WEEKLY RANKING",
    title: "週間ランキング",
    description:
      "直近1週間の人気動画をランキング形式で表示します。",
    seoTitle: "X動画の週間ランキング",
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
      rankingItemList(copy.seoTitle, path, initialPosts)
    ]
  };

  return (
    <main>
      <StructuredData data={structuredData} />
      <header className="ranking-page-header">
        <Link className="ranking-brand" href={rankingHref("trending", edition)}>
          <span>X</span> CLIP RANK
        </Link>
        <p className="ranking-eyebrow">{copy.eyebrow}</p>
        <h1 className="ranking-page-title">{copy.title}</h1>
        <p className="ranking-page-description">{copy.description}</p>
      </header>

      <nav className="ranking-page-nav" aria-label="ランキングを選択">
        <Link href={rankingHref("trending", edition)}>新着</Link>
        <Link
          href={rankingHref("daily", edition)}
          className={range === "daily" ? "active" : undefined}
          aria-current={range === "daily" ? "page" : undefined}
        >
          24時間
        </Link>
        <Link
          href={rankingHref("weekly", edition)}
          className={range === "weekly" ? "active" : undefined}
          aria-current={range === "weekly" ? "page" : undefined}
        >
          週間
        </Link>
        <Link href="/reels">リール</Link>
        <Link href="/download">動画保存</Link>
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
          <Link href={rankingHref("trending", edition)}>新着ランキング</Link>
          {range === "daily" ? (
            <Link href={rankingHref("weekly", edition)}>週間ランキング</Link>
          ) : (
            <Link href={rankingHref("daily", edition)}>24時間ランキング</Link>
          )}
        </p>
      </section>

      <footer>
        <p>
          動画ファイル自体はすべてXのサービス上にあり、当サイトでは動画ファイルの保存・収集・再アップロードを行っていません。
        </p>
        <p>
          違法または権利侵害と思われる投稿は、
          <Link href="/removal-request">削除要請フォーム</Link>
          からお知らせください。
        </p>
      </footer>
    </main>
  );
}
