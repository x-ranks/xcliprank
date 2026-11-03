import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { readPublicBrowse } from "../../lib/public-video-server";
import { SITE_URL } from "../../lib/seo";
import { browseHref } from "../../lib/public-list-pages";
import SiteBrand from "../components/SiteBrand";
import PublicVideoCards from "../components/PublicVideoCards";
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ page?: string | string[] }> };
function pageNumber(value: string | string[] | undefined) {
  if (value === undefined) return 1;
  if (typeof value !== "string" || !/^[1-9]\d{0,3}$/.test(value)) notFound();
  return Number(value);
}
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const page = pageNumber((await searchParams).page);
  const canonical = SITE_URL + browseHref(page);
  return { title: `動画一覧 ${page}ページ`, description: "twizouに掲載中の動画をサムネイル・投稿本文・投稿者から探せる一覧です。", alternates: { canonical },
    robots: { index: true, follow: true, "max-image-preview": "large" }, openGraph: { title: `動画一覧 ${page}ページ｜twizou`, url: canonical } };
}
export default async function BrowsePage({ searchParams }: Props) {
  const page = pageNumber((await searchParams).page), data = await readPublicBrowse(page);
  if (!data) notFound();
  return <main style={{ maxWidth: 1120, margin: "0 auto", padding: 24 }}>
    <SiteBrand /><Link href="/">新着ランキング</Link> ／ <Link href="/accounts">投稿者一覧</Link>
    <h1>動画一覧</h1><p>掲載中の動画を投稿IDの新しい順に表示しています。全{data.totalCount}件、{page} / {data.totalPages}ページ。</p>
    <nav aria-label="動画一覧のページ" style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 20 }}>
      {Array.from({ length: data.totalPages }, (_, i) => <Link key={i} href={browseHref(i + 1)} aria-current={page === i + 1 ? "page" : undefined}>{i + 1}</Link>)}
    </nav>
    {data.videos.length ? <PublicVideoCards priorityCount={4} videos={data.videos} returnTo={browseHref(page)} /> : <p>現在このページで掲載できる動画はありません。</p>}
  </main>;
}
