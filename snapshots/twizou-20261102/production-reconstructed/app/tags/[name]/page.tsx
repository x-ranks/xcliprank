import SiteBrand from "../../components/SiteBrand";
import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import PublicVideoCards from "../../components/PublicVideoCards";
import { PUBLIC_SITE, tagHref } from "../../../lib/public-video-core";
import { SITE_NAME } from "../../../lib/seo";
import { readPublicTag, readPublicLabels } from "../../../lib/public-video-server";
export const dynamic = "force-dynamic";
type Props = { params: Promise<{ name: string }>; searchParams?: Promise<{ page?: string | string[] }> };
async function readPage(props: Props) {
  const { name } = await props.params, search = await props.searchParams;
  const raw = search?.page;
  if (raw !== undefined && (typeof raw !== "string" || !/^[1-9]\d{0,3}$/.test(raw))) notFound();
  const page = raw === undefined ? 1 : Number(raw);
  return { d: await readPublicTag(name, page), page, name };
}
export async function generateMetadata(props: Props): Promise<Metadata> {
  const { d, page } = await readPage(props);
  if (!d) return {};
  const title = `${d.label.name}のTwitter動画一覧・保存${page > 1 ? `｜${page}ページ` : ""}｜${SITE_NAME}`;
  const description = `${d.label.name}タグのTwitter（X）動画${d.totalCount ?? d.videos.length}件を紹介。${d.facts?.authorCount ? `${d.facts.authorCount}投稿者の掲載動画から、` : ""}動画の再生・保存や元投稿の確認ができます。`;
  const canonical = PUBLIC_SITE + tagHref(d.label) + (page > 1 ? `?page=${page}` : "");
  const poster = d.videos.find(video => video.posterUrl)?.posterUrl;
  return { title: { absolute: title }, description, alternates: { canonical }, robots: { index: d.index, follow: true, "max-image-preview": "large" },
    openGraph: { title, description, url: canonical, ...(poster ? { images: [poster] } : {}) },
    twitter: { card: poster ? "summary_large_image" : "summary", title, description, ...(poster ? { images: [poster] } : {}) } };
}
export default async function TagPage(props: Props) {
  const { name, d, page } = await readPage(props); if (!d) notFound();
  const base = tagHref(d.label);
  // App Router may provide a decoded name or the percent-encoded route segment.
  // Comparing the encoded segment to the display name redirects to the same URL forever.
  const sameRoute = (value: string) => value.replace(/%[0-9a-f]{2}/gi, escape => escape.toUpperCase());
  if (name.normalize("NFC") !== d.label.name && sameRoute(name) !== sameRoute(encodeURIComponent(d.label.name)))
    permanentRedirect(base + (page > 1 ? `?page=${page}` : ""));
  const availableTags = (await readPublicLabels().catch(() => [])).filter(tag => tag.index && tag.count > 0 && tag.name !== d.label.name);
  const relatedTags = d.facts ? d.facts.tags.filter(tag => availableTags.some(available => available.name === tag.name)) : [];
  const returnTo = base + (page > 1 ? `?page=${page}` : "");
  return <main style={{ maxWidth: 1120, margin: "0 auto", padding: 24 }}><SiteBrand /><a href="/tags">タグ一覧</a><h1>{d.label.name}のTwitter動画一覧</h1>
    <p>{d.label.name}タグの掲載動画{d.totalCount ?? d.videos.length}件{d.facts?.authorCount ? `・${d.facts.authorCount}投稿者` : ""}。動画を再生・保存し、元投稿を確認できます。</p>
    <p>{d.totalCount}件中 {page} / {d.totalPages}ページ</p>
    {d.videos.length ? <PublicVideoCards priorityCount={4} videos={d.videos} returnTo={returnTo} nativeNavigation /> : <p>現在掲載できる動画はありません。</p>}
    {relatedTags.length ? <nav className="public-post-tags" aria-label="一緒に付けられているタグ">{relatedTags.map(tag => <a key={tag.id} href={tagHref({ ...tag, active: true })}>{tag.name} {tag.count}件</a>)}</nav> : null}
    <nav aria-label="タグの動画ページ" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
      {Array.from({ length: d.totalPages }, (_, i) => <a key={i} href={i === 0 ? base : `${base}?page=${i + 1}`}
        aria-current={i + 1 === page ? "page" : undefined}>{i + 1}</a>)}
    </nav></main>;
}
