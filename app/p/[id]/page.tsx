import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import DirectPlaybackVideo from "../../components/DirectPlaybackVideo";
import VideoDownloadButton from "../../components/VideoDownloadButton";
import PublicVideoCards from "../../components/PublicVideoCards";
import { authorHref, originalHref, publicPostId, tagHref } from "../../../lib/public-video-core";
import { readPublicDetail } from "../../../lib/public-video-server";
export const dynamic = "force-dynamic";
type Props = { params: Promise<{ id: string }> };
async function data({ params }: Props) { const { id } = await params; if (!publicPostId(id)) return null; return readPublicDetail(id); }
export async function generateMetadata(props: Props): Promise<Metadata> {
  const d = await data(props); if (!d) return { title: "動画が見つかりません", robots: { index: false, follow: true } };
  return { title: { absolute: d.metadata.title }, description: d.metadata.description, alternates: { canonical: d.metadata.canonical }, robots: { index: d.metadata.index, follow: true },
    openGraph: { type: "website", title: d.metadata.title, description: d.metadata.description, url: d.metadata.canonical, ...(d.video.posterUrl ? { images: [d.video.posterUrl] } : {}) } };
}
export default async function PostPage(props: Props) {
  const d = await data(props); if (!d) notFound(); const { video: v, metadata: m } = d;
  return <main style={{ maxWidth: 1120, margin: "0 auto", padding: 24 }}>
    <nav aria-label="現在位置"><Link href="/">新着一覧</Link> ／ <Link href={authorHref(v)!}>{v.authorName ?? v.handle ?? "投稿者"}</Link> ／ 動画</nav>
    <h1>{v.authorName ?? v.handle ?? "投稿者"}の動画を保存</h1>
    <VideoDownloadButton postId={v.id} />
    <DirectPlaybackVideo postId={v.id} src={v.videoUrl} poster={v.posterUrl ?? undefined} controls playsInline preload="metadata" style={{ width: "100%", maxHeight: "70vh", background: "#000" }} />
    {v.text?.trim() ? <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{v.text}</p> : <p>この投稿の本文は登録されていません。</p>}
    <p><a href={originalHref(v)} target="_blank" rel="noopener noreferrer">元投稿をXで開く</a> ／ <Link href={authorHref(v)!}>投稿者ページを見る</Link></p>
    {m.saveCount !== null && m.firstSavedAt ? <p>保存数（受信後の保存操作）：{m.saveCount}件 ／ 初回保存：<time dateTime={m.firstSavedAt}>{new Date(m.firstSavedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}</time>（日本時間）</p> : null}
    {m.saveCount !== null ? <p style={{ fontSize: 13 }}>動画の受信後にブラウザへ保存を要求した操作の記録です。端末内への保存完了までは確認できません。</p> : null}
    <nav aria-label="動画のラベル" style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>{d.labels.map(l => <Link key={l.id} href={tagHref(l)}>{l.name}</Link>)}</nav>
    <section><h2>同じ投稿者の他動画</h2>{d.sameAuthor.length ? <PublicVideoCards videos={d.sameAuthor} /> : <p>現在掲載できる他の動画はありません。</p>}</section>
    <section><h2>ラベルでつながる関連動画</h2>{d.related.length ? <PublicVideoCards videos={d.related} /> : <p>確認済みラベルで一致する掲載可能な動画が増えると表示します。</p>}</section>
  </main>;
}
