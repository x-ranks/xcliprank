import type { Metadata } from "next";
import Link from "next/link";
import PublicPostClose from "../../components/PublicPostClose";
import { safePublicReturn } from "../../../lib/public-return-navigation";
import { notFound } from "next/navigation";
import DirectPlaybackVideo from "../../components/DirectPlaybackVideo";
import VideoDownloadButton from "../../components/VideoDownloadButton";
import PublicVideoCards from "../../components/PublicVideoCards";
import StructuredData from "../../components/StructuredData";
import PublicPostEngagement from "../../components/PublicPostEngagement";
import { authorHref, originalHref, publicPostId, tagHref, videoSummary } from "../../../lib/public-video-core";
import { readPublicDetail, readPublicLabels } from "../../../lib/public-video-server";
export const dynamic = "force-dynamic";
type Props = { params: Promise<{ id: string }>; searchParams?: Promise<{ from?: string | string[] }> };
async function data({ params }: Props) { const { id } = await params; if (!publicPostId(id)) return null; return readPublicDetail(id); }
export async function generateMetadata(props: Props): Promise<Metadata> {
  const d = await data(props); if (!d) return {};
  return { title: { absolute: d.metadata.title }, description: d.metadata.description, alternates: { canonical: d.metadata.canonical }, robots: { index: d.metadata.index, follow: true },
    openGraph: { type: "video.other", title: d.metadata.title, description: d.metadata.description, url: d.metadata.canonical, ...(d.video.posterUrl ? { images: [d.video.posterUrl] } : {}) },
    twitter: { card: d.video.posterUrl ? "summary_large_image" : "summary", title: d.metadata.title, description: d.metadata.description, ...(d.video.posterUrl ? { images: [d.video.posterUrl] } : {}) } };
}
export default async function PostPage(props: Props) {
  const d = await data(props); if (!d) notFound(); const { video: v, metadata: m } = d;
  const query = await props.searchParams; const sourcePage = safePublicReturn(query?.from); const returnTo = sourcePage ?? "/";
  const tagStats = await readPublicLabels().catch(() => null);
  const indexableTags = (tagStats ?? []).filter(label => label.index);
  const ownTagNames = new Set(d.labels.map(label => label.name.normalize("NFC")));
  const ownTags = tagStats === null ? d.labels : indexableTags.filter(label => ownTagNames.has(label.name));
  const otherTags = indexableTags.filter(label => !ownTagNames.has(label.name));
  return <main className="public-post-page">
    <PublicPostEngagement postId={v.id} sourcePage={sourcePage} />
    {v.posterUrl && v.createdAt ? <StructuredData data={{ "@context": "https://schema.org", "@type": "VideoObject", name: m.title, description: m.description,
      thumbnailUrl: v.posterUrl, uploadDate: v.createdAt, contentUrl: v.videoUrl, url: m.canonical, isFamilyFriendly: false }} /> : null}
    <PublicPostClose returnTo={returnTo} />
    <nav aria-label="現在位置"><Link href="/">新着一覧</Link> ／ <Link href={authorHref(v)!}>{v.authorName ?? v.handle ?? "投稿者"}</Link> ／ 動画</nav>
    <h1>{v.authorName ?? v.handle ?? "投稿者"}の動画</h1>
    <div className="public-post-actions" aria-label="動画の操作">
      <VideoDownloadButton postId={v.id} showCaption={false} />
      <a href={originalHref(v)} target="_blank" rel="noopener noreferrer">元投稿をXで開く</a>
      {authorHref(v) ? <Link href={authorHref(v)!}>投稿者ページを見る</Link> : null}
    </div>
    <div className="public-post-player">
      <DirectPlaybackVideo postId={v.id} src={v.videoUrl} poster={v.posterUrl ?? undefined} controls playsInline preload="metadata" style={{ width: "100%", maxHeight: "70vh", background: "#000" }} />
    </div>
    {v.text?.trim() ? <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{v.text}</p> : <p>{videoSummary(v, d.labels)}</p>}
    {v.createdAt ? <p>投稿日：<time dateTime={v.createdAt}>{new Date(v.createdAt).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" })}</time></p> : null}
    {m.saveCount !== null && m.saveCount > 0 ? <p>このサイト経由の保存：{m.saveCount}件{m.firstSavedAt ? <> ／ 初回保存：<time dateTime={m.firstSavedAt}>{new Date(m.firstSavedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}</time>（日本時間）</> : null}</p> : null}
    {[v.views, v.likes, v.bookmarks].some(n => n !== null && n !== undefined) ? <p>X側の観測値：{v.views != null ? `表示 ${v.views.toLocaleString()}回` : "表示 未取得"} ／ {v.likes != null ? `いいね ${v.likes.toLocaleString()}件` : "いいね 未取得"} ／ {v.bookmarks != null ? `ブックマーク ${v.bookmarks.toLocaleString()}件` : "ブックマーク 未取得"}。サイト経由の保存操作とは別の指標です。</p> : null}
    <p>現在の順位は<Link href="/ranking/daily">24時間ランキング</Link>・<Link href="/ranking/weekly">週間ランキング</Link>で確認できます。</p>
    {m.saveCount !== null && m.saveCount > 0 ? <p style={{ fontSize: 13 }}>動画の受信後にブラウザへ保存を要求した操作の記録です。端末内への保存完了までは確認できません。</p> : null}
    {ownTags.length ? <section aria-label="この動画のタグ"><h2>この動画に付けられたタグ</h2><nav className="public-post-tags">{ownTags.map(label => <a key={label.id} href={tagHref({ ...label, active: true })}>{label.name}</a>)}</nav></section> : null}
    {otherTags.length ? <nav aria-label="ほかの動画のタグ" className="public-post-tags"><span>タグから探す</span>{otherTags.map(label => <a key={label.id} href={tagHref({ ...label, active: true })}>{label.name}</a>)}</nav> : null}
    <section><h2>同じ投稿者の他動画</h2>{d.sameAuthor.length ? <PublicVideoCards videos={d.sameAuthor} returnTo={returnTo} /> : <p>現在掲載できる他の動画はありません。</p>}</section>
    <section><h2>関連動画</h2>{d.related.length ? <PublicVideoCards videos={d.related} returnTo={returnTo} /> : <p>関連動画がありません。</p>}</section>
  </main>;
}
