import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { readPublicAccountCards } from "../../lib/public-video-server";
import { SITE_URL } from "../../lib/seo";
import { accountPageCount, accountListHref } from "../../lib/public-list-pages";
import SiteBrand from "../components/SiteBrand";
import PublicThumbnail from "../components/PublicThumbnail";
export const dynamic = "force-dynamic";
const PAGE_SIZE = 40;
// Sort choices are provisional; the default (post count) is the only one search engines index.
const SORTS = [
  { key: "count", label: "投稿数の多い順" },
  { key: "views", label: "表示数の多い順" },
  { key: "latest", label: "新しい投稿順" },
] as const;
type SortKey = typeof SORTS[number]["key"];
type Props = { searchParams: Promise<{ page?: string | string[]; sort?: string | string[] }> };
function pageNumber(value: string | string[] | undefined) {
  if (value === undefined) return 1;
  if (typeof value !== "string" || !/^[1-9]\d{0,3}$/.test(value)) notFound();
  return Number(value);
}
const sortKey = (value: string | string[] | undefined): SortKey => SORTS.find(s => s.key === value)?.key ?? "count";
const listHref = (page: number, sort: SortKey) => sort === "count" ? accountListHref(page) : `/accounts?${page > 1 ? `page=${page}&` : ""}sort=${sort}`;
const compact = (n: number) => n >= 10000 ? `${(n / 10000).toFixed(n >= 100000 ? 0 : 1).replace(/\.0$/, "")}万` : n.toLocaleString("ja-JP");
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const params = await searchParams, page = pageNumber(params.page), sort = sortKey(params.sort);
  const canonical = SITE_URL + accountListHref(page);
  return { title: `投稿者一覧 ${page}ページ`, description: "twizouに掲載中の投稿者を全件たどれる一覧です。", alternates: { canonical },
    robots: { index: sort === "count", follow: true }, openGraph: { title: `投稿者一覧 ${page}ページ｜twizou`, url: canonical } };
}
export default async function AccountListPage({ searchParams }: Props) {
  const params = await searchParams, page = pageNumber(params.page), sort = sortKey(params.sort);
  const all = await readPublicAccountCards();
  const pages = accountPageCount(all.length);
  if (page > pages) notFound();
  const sorted = sort === "count" ? all : [...all].sort((a, b) => sort === "views" ? b.views - a.views || b.count - a.count : b.latest.localeCompare(a.latest) || b.count - a.count);
  const cards = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  return <main className="accounts-page">
    <SiteBrand showSearch active="accounts" />
    <h1 className="ranking-page-title">投稿者一覧</h1>
    <p className="ranking-page-description">掲載条件を満たす投稿者、全{all.length}件。サムネイルは最近の動画です。</p>
    <nav className="accounts-sort" aria-label="並び替え">
      {SORTS.map(s => <Link key={s.key} prefetch={false} href={listHref(1, s.key)} className={sort === s.key ? "active" : undefined} aria-current={sort === s.key ? "true" : undefined}>{s.label}</Link>)}
    </nav>
    <ul className="account-grid">{cards.map(account => <li key={account.key}>
      <Link className="account-card" prefetch={false} href={`/accounts/${encodeURIComponent(account.key)}`}>
        <span className="account-thumbs" aria-hidden="true">{[0, 1, 2].map(i => account.thumbs[i]
          ? <PublicThumbnail key={account.thumbs[i].id} src={account.thumbs[i].url} alt="" width={160} height={160} loading="lazy" decoding="async" />
          : <span key={i} className="account-thumb-empty" />)}</span>
        <span className="account-meta">
          <span className="account-avatar" aria-hidden="true">{String.fromCodePoint(account.name.codePointAt(0) ?? 64).toUpperCase()}</span>
          <span className="account-name"><strong>{account.name}</strong><small>@{account.key}</small></span>
        </span>
        <span className="account-stats">投稿 {account.count.toLocaleString("ja-JP")}{account.views > 0 ? ` ／ 合計表示 ${compact(account.views)}` : ""}</span>
      </Link></li>)}</ul>
    <nav className="accounts-pages" aria-label="投稿者一覧のページ">
      {Array.from({ length: pages }, (_, i) => <Link key={i} prefetch={false} href={listHref(i + 1, sort)} aria-current={page === i + 1 ? "page" : undefined}>{i + 1}</Link>)}
    </nav>
  </main>;
}
