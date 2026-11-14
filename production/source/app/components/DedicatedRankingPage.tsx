import RankingNavLink from "./RankingNavLink";
import SiteBrand from "./SiteBrand";
import { rankingHref } from "../../lib/ranking-pagination";
import Link from "next/link";
import type { RankingUpdate } from "../../lib/ranking-update";
import RankingClient, { type RankPost } from "./RankingClient";
import SiteFooter from "./SiteFooter";
import NewSinceVisit from "./NewSinceVisit";
import StructuredData from "./StructuredData";
import { rankingBreadcrumb, rankingItemList } from "../../lib/seo";
import { INITIAL_RANKING_COUNTS } from "../../lib/ranking-display";

type DedicatedRange = "daily" | "weekly";

const PAGE_COPY = {
  daily: {
    eyebrow: "DAILY RANKING",
    title: "24時間ランキング",
    description:
      "直近24時間のX（Twitter）動画と、過去のおすすめを日替わりで紹介します。",
    seoTitle: "Twitter動画の24時間ランキング・保存",
    seoDescription:
      "新着ランキングとはひと味違う動画を探したいときにどうぞ。",
    reading:
      "直近24時間のX（Twitter）動画と、過去のおすすめを日替わりで紹介しています。新着順の一覧とは違う動画に出会えます。",
    other: "週間ランキングは、直近1週間の動画を中心に、人気やtwizouでの評価をもとに選んでいます。"
  },
  weekly: {
    eyebrow: "WEEKLY RANKING",
    title: "週間ランキング",
    description:
      "直近1週間のX（Twitter）動画を中心に、人気やtwizouでの評価をもとに選んでいます。",
    seoTitle: "Twitter動画の週間ランキング・保存",
    seoDescription:
      "動画が少ないときは、過去のおすすめも加えています。",
    reading:
      "直近1週間のX（Twitter）動画を中心に、人気やtwizouでの評価をもとに選んでいます。動画が少ないときは、過去のおすすめも加えています。",
    other: "24時間ランキングは、直近24時間の動画と、過去のおすすめを日替わりで紹介しています。"
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
        <SiteBrand showSearch active="ranking" />
        <h1 className="ranking-page-title">{copy.title}</h1>
        <p className="ranking-page-description">{copy.description}</p>
      </header>

      <nav className="ranking-page-nav" aria-label="ランキングを選択">
        <RankingNavLink
          href={rankingHref("daily")}
          className={range === "daily" ? "active" : undefined}
          aria-current={range === "daily" ? "page" : undefined}
        >
          24時間
        </RankingNavLink>
        <RankingNavLink
          href={rankingHref("weekly")}
          className={range === "weekly" ? "active" : undefined}
          aria-current={range === "weekly" ? "page" : undefined}
        >
          週間
        </RankingNavLink>
        <a href="/ranking/30days">30日</a>
        <a href="/ranking/all">全期間</a>
        <a href="/ranking/history">過去</a>
      </nav>

      <NewSinceVisit ids={initialPosts.map(post => String(post.x_post_id))} />

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
        <h3>このランキングの見方</h3>
        <p>{copy.reading}</p>
        <h3>動画の見かた・使いかた</h3>
        <p>動画をタップすると再生できます。動画ページでは、元投稿をXで開く、投稿者の動画一覧を見る、☆でお気に入りに入れる、動画を保存する、といった操作ができます。</p>
        <h3>よくある質問</h3>
        <div className="seo-faq">
          <details>
            <summary>24時間ランキングと週間ランキングの違いは？</summary>
            <p>{copy.other}</p>
          </details>
          <details>
            <summary>動画を保存できますか？</summary>
            <p>権利者が保存を許可した動画だけを保存してください。手順は<Link prefetch={false} href="/download">動画保存のページ</Link>、条件は<Link prefetch={false} href="/download-policy">保存ポリシー</Link>で確認できます。</p>
          </details>
          <details>
            <summary>見られなくなった動画があるのはなぜ？</summary>
            <p>元の投稿が削除・非公開になった動画や、掲載の対象外になった動画は、表示されなくなることがあります。</p>
          </details>
          <details>
            <summary>問題のある動画を見つけたら？</summary>
            <p>動画ページの「報告」ボタンから、<Link prefetch={false} href="/removal-request">削除要請フォーム</Link>で知らせてください。</p>
          </details>
        </div>
        <p className="seo-related-links">
          <Link prefetch={false} href={rankingHref("trending")}>新着ランキング</Link>
          {range === "daily" ? (
            <Link prefetch={false} href={rankingHref("weekly")}>週間ランキング</Link>
          ) : (
            <Link prefetch={false} href={rankingHref("daily")}>24時間ランキング</Link>
          )}
          <Link prefetch={false} href="/ranking/30days">30日ランキング</Link>
          <Link prefetch={false} href="/ranking/all">全期間ランキング</Link>
          <Link prefetch={false} href="/ranking/history">過去のランキング</Link>
        </p>
      </section>

      <SiteFooter />
    </main>
  );
}
