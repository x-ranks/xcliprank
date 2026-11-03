import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { readPublicIndex } from "../../lib/public-video-server";
import { SITE_URL } from "../../lib/seo";
import { accountPageCount, accountListHref } from "../../lib/public-list-pages";
export const dynamic = "force-dynamic";
const PAGE_SIZE = 40;
type Props = { searchParams: Promise<{ page?: string | string[] }> };
function pageNumber(value: string | string[] | undefined) {
  if (value === undefined) return 1;
  if (typeof value !== "string" || !/^[1-9]\d{0,3}$/.test(value)) notFound();
  return Number(value);
}
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const page = pageNumber((await searchParams).page);
  const canonical = SITE_URL + accountListHref(page);
  return { title: `投稿者一覧 ${page}ページ`, description: "twizouに掲載中の投稿者を全件たどれる一覧です。", alternates: { canonical },
    robots: { index: true, follow: true }, openGraph: { title: `投稿者一覧 ${page}ページ｜twizou`, url: canonical } };
}
export default async function AccountListPage({ searchParams }: Props) {
  const page = pageNumber((await searchParams).page), index = await readPublicIndex();
  const pages = accountPageCount(index.accounts.length);
  if (page > pages) notFound();
  const accounts = index.accounts.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  return <main style={{ maxWidth: 1000, margin: "0 auto", padding: 24 }}>
    <Link href="/">新着ランキング</Link> ／ <Link href="/browse">動画一覧</Link>
    <h1>投稿者一覧</h1><p>掲載条件を満たす投稿者、全{index.accounts.length}件。</p>
    <nav aria-label="投稿者一覧のページ" style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
      {Array.from({ length: pages }, (_, i) => <Link key={i} href={accountListHref(i + 1)} aria-current={page === i + 1 ? "page" : undefined}>{i + 1}</Link>)}
    </nav>
    <ul style={{ display: "grid", gap: 8 }}>{accounts.map(account => <li key={account.key}>
      <Link href={`/accounts/${encodeURIComponent(account.key)}`}>@{account.key}</Link></li>)}</ul>
  </main>;
}
