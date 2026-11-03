import SiteBrand from "../../components/SiteBrand";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import PublicVideoCards from "../../components/PublicVideoCards";
import { PUBLIC_SITE, tagHref } from "../../../lib/public-video-core";
import { readPublicAccount } from "../../../lib/public-video-server";
import { SITE_NAME } from "../../../lib/seo";
export const dynamic = "force-dynamic";
type Props = { params: Promise<{ key: string }>; searchParams?: Promise<{ page?: string | string[] }> };
async function readPage(props: Props) {
  const { key } = await props.params, search = await props.searchParams;
  const raw = search?.page;
  if (raw !== undefined && (typeof raw !== "string" || !/^[1-9]\d{0,3}$/.test(raw))) notFound();
  const page = raw === undefined ? 1 : Number(raw);
  return { d: await readPublicAccount(key, page), page };
}
export async function generateMetadata(props: Props): Promise<Metadata> {
  const { d, page } = await readPage(props);
  if (!d) return {};
  const canonical = `${PUBLIC_SITE}/accounts/${encodeURIComponent(d.canonicalKey)}${page > 1 ? `?page=${page}` : ""}`;
  const identity = d.handle && d.name !== d.handle && d.name !== "@" + d.handle ? `${d.name}(@${d.handle})` : d.name;
  const title = `${identity}のTwitter動画一覧・保存${page > 1 ? `｜${page}ページ` : ""}｜${SITE_NAME}`;
  const description = `${identity}のTwitter（X）動画を新しい順に紹介。この一覧の${d.totalCount ?? d.videos.length}件から、動画の再生・保存や元投稿の確認ができます。${d.facts?.tags.length ? `よく付くタグ：${d.facts.tags.slice(0, 3).map(tag => tag.name).join("、")}。` : ""}`;
  const images = d.videos.find(v => v.posterUrl)?.posterUrl;
  return { title: { absolute: title }, description, alternates: { canonical }, robots: { index: d.index, follow: true },
    openGraph: { type: "website", title, description, url: canonical, ...(images ? { images: [images] } : {}) },
    twitter: { card: "summary_large_image", title, description, ...(images ? { images: [images] } : {}) } };
}
export default async function AccountPage(props: Props) {
  const { d, page } = await readPage(props); if (!d) notFound();
  const base = `/accounts/${encodeURIComponent(d.canonicalKey)}`;
  return <main style={{ maxWidth: 1120, margin: "0 auto", padding: 24 }}><SiteBrand /><Link href="/accounts">投稿者一覧</Link><h1>{d.name}のTwitter動画一覧</h1>{d.handle ? <p>@{d.handle}</p> : null}
    <p>掲載中の最新動画{d.totalCount ?? d.videos.length}件を新しい順に紹介。再生・保存や元投稿の確認ができます。</p>
    {d.facts?.tags.length ? <nav className="public-post-tags" aria-label="この投稿者の動画によく付くタグ">{d.facts.tags.map(tag => <Link key={tag.name} href={tagHref({ ...tag, active: true })}>{tag.name} {tag.count}件</Link>)}</nav> : null}
    <p>{page} / {d.totalPages}ページ</p><PublicVideoCards priorityCount={4} videos={d.videos} returnTo={page > 1 ? `${base}?page=${page}` : base} />
    <nav aria-label="投稿者の動画ページ" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
      {Array.from({ length: d.totalPages }, (_, i) => <Link key={i} href={i === 0 ? base : `${base}?page=${i + 1}`}
        aria-current={i + 1 === page ? "page" : undefined}>{i + 1}</Link>)}
    </nav></main>;
}
