import { Suspense } from "react";
import { headers } from "next/headers";
import AgeGate from "../../components/AgeGate";
import { publicVideoSchema } from "../../../lib/public-video-schema";
import PublicPostText from "../../components/PublicPostText";
import SiteBrand from "../../components/SiteBrand";
import type { Metadata } from "next";
import Link from "next/link";
import PublicPostClose from "../../components/PublicPostClose";
import { safePublicReturn } from "../../../lib/public-return-navigation";
import { notFound } from "next/navigation";
import DirectPlaybackVideo from "../../components/DirectPlaybackVideo";
import VideoDownloadButton from "../../components/VideoDownloadButton";
import FavoriteButton from "../../components/FavoriteButton";
import PublicVideoCards from "../../components/PublicVideoCards";
import StructuredData from "../../components/StructuredData";
import FollowButton from "../../components/FollowButton";
import PublicPostEngagement from "../../components/PublicPostEngagement";
import { accountKey, authorHref, originalHref, publicPostId, tagHref, publicVideoFacts } from "../../../lib/public-video-core";
import { readPublicDetailCore, readPublicRelated } from "../../../lib/public-video-server";
import { shareVideoHref } from "../../../lib/share-video";
export const dynamic = "force-dynamic";
type Props = { params: Promise<{ id: string }>; searchParams?: Promise<{ from?: string | string[] }> };
async function data({ params }: Props) { const { id } = await params; if (!publicPostId(id)) return null; return readPublicDetailCore(id); }
export async function generateMetadata(props: Props): Promise<Metadata> {
  const d = await data(props); if (!d) return {};
  return { title: { absolute: d.metadata.title }, description: d.metadata.description, alternates: { canonical: d.metadata.canonical }, robots: { index: d.metadata.index, follow: true, "max-image-preview": "large" },
    openGraph: { type: "video.other", title: d.metadata.title, description: d.metadata.description, url: d.metadata.canonical, ...(d.video.posterUrl ? { images: [d.video.posterUrl] } : {}) },
    twitter: { card: d.video.posterUrl ? "summary_large_image" : "summary", title: d.metadata.title, description: d.metadata.description, ...(d.video.posterUrl ? { images: [d.video.posterUrl] } : {}) } };
}
export default async function PostPage(props: Props) {
  const verifiedGooglebot = (await headers()).get("x-twizou-verified-googlebot") === "1";
  const d = await data(props); if (!d) notFound(); const { video: v, metadata: m } = d;
  const facts = publicVideoFacts(v, d.technical);
  const query = await props.searchParams; const sourcePage = safePublicReturn(query?.from); const returnTo = sourcePage ?? "/";
  return <><AgeGate verifiedGooglebot={verifiedGooglebot} forceForPost /><main className="public-post-page">
    <SiteBrand />
    <PublicPostEngagement postId={v.id} sourcePage={sourcePage} />
    {publicVideoSchema(v, m, d.labels, d.technical) ? <StructuredData data={publicVideoSchema(v, m, d.labels, d.technical)!} /> : null}
    <StructuredData data={{ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "twizou", item: "https://twizou.net/rising" },
      { "@type": "ListItem", position: 2, name: v.authorName ?? v.handle ?? "投稿者", item: "https://twizou.net" + authorHref(v)! },
      { "@type": "ListItem", position: 3, name: (v.authorName ?? v.handle ?? "投稿者") + "の動画", item: m.canonical },
    ] }} />
    <PublicPostClose postId={v.id} returnTo={sourcePage ?? undefined} />
    <nav aria-label="現在位置"><Link href="/rising">twizou</Link> ／ <Link href={authorHref(v)!}>{v.authorName ?? v.handle ?? "投稿者"}</Link> ／ 動画</nav>
    {accountKey(v) ? <div className="post-author-follow"><span className="post-author-name">投稿者：{v.authorName ?? v.handle ?? "投稿者"}</span><FollowButton accountKey={accountKey(v)!} compact /></div> : null}
    <h1>{postHeading(v)}</h1>
    <div className="public-post-player">
      <DirectPlaybackVideo trackQualifiedView engagementSourcePage={sourcePage} postId={v.id} src={v.videoUrl} poster={v.posterUrl ?? undefined} controls playsInline preload="metadata" aria-label={(v.authorName ?? v.handle ?? "投稿者") + "の動画プレーヤー"} style={{ width: "100%", maxHeight: "70vh", background: "#000" }} />
    </div>

    <div className="public-post-actions" aria-label="動画の操作">
      <VideoDownloadButton postId={v.id} showCaption={false} />
      <FavoriteButton id={v.id} />
      <a className="share-to-x" href={shareVideoHref(v.id, null, { author: v.authorName ?? v.handle })!} target="_blank" rel="noopener noreferrer" aria-label="この動画をXで共有">Xで共有</a>
      <Link href={`/removal-request?post=${v.id}`} prefetch={false} rel="nofollow">この動画を報告する</Link>
      <a href={originalHref(v)} target="_blank" rel="noopener noreferrer">元投稿をXで開く</a>
      {authorHref(v) ? <Link href={authorHref(v)!}>投稿者ページを見る</Link> : null}
    </div>
    <PostTags detail={d} />
    {facts.length ? <dl className="public-video-facts" aria-label="動画の情報">{facts.map(fact => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.dateTime ? <time dateTime={fact.dateTime}>{fact.value}</time> : fact.value}</dd></div>)}</dl> : null}
    {m.saveCount !== null && m.saveCount > 0 ? <p>サイト内の保存操作：{m.saveCount}件</p> : null}
    <Suspense fallback={<section aria-label="関連動画を準備中" style={{ minHeight: 280 }}><h2>関連動画</h2><p role="status">動画を読み込んでいます…</p></section>}>
      <PostRelated id={v.id} returnTo={returnTo} />
    </Suspense>
  </main></>;
}

// The heading names the post, not only the author: a bare "k" or emoji-only name says nothing to search.
function postHeading(v: { authorName?: string | null; handle?: string | null; text?: string | null }) {
  const author = v.authorName ?? v.handle ?? "投稿者";
  const text = (v.text ?? "").replace(/https?:\/\/\S+/g, " ").replace(/\s+/g, " ").trim();
  const excerpt = text.length > 40 ? text.slice(0, 40) + "…" : text;
  return excerpt ? `${author}の動画「${excerpt}」` : `${author}の動画`;
}

// Nonessential panels must not keep the streamed player response open indefinitely.
async function optionalDetailData<T>(load: () => Promise<T>, budgetMs: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(load),
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), budgetMs); })
    ]);
  } catch { return null; }
  finally { if (timer !== undefined) clearTimeout(timer); }
}
function PostTags({ detail: d }: { detail: NonNullable<Awaited<ReturnType<typeof readPublicDetailCore>>> }) {
  const v = d.video;
  return <>
    {v.text?.trim() ? <PublicPostText text={v.text} tags={d.labels.map(label => ({ name: label.name, href: tagHref(label) }))} /> : null}
    {d.labels.length ? <section aria-label="この動画のタグ"><h2>この動画に付けられたタグ</h2><nav className="public-post-tags">{d.labels.map(label => <a key={label.id} href={tagHref(label)}>{label.name}</a>)}</nav></section> : null}
    <nav aria-label="タグから探す" className="public-post-tags"><Link href="/tags" prefetch={false}>タグ一覧を見る</Link></nav>
  </>;
}
async function PostRelated({ id, returnTo }: { id: string; returnTo: string }) {
  let related;
  related = await optionalDetailData(() => readPublicRelated(id), 4000);
  if (!related) return <p>ほかの動画は<Link href="/browse">動画一覧</Link>からご覧ください。</p>;
  return <>    <section><h2>同じ投稿者の他動画</h2>{related.sameAuthor.length ? <PublicVideoCards videos={related.sameAuthor} returnTo={returnTo} /> : <p>現在掲載できる他の動画はありません。</p>}</section>
    <section><h2>{related.related.length ? "関連動画" : "おすすめの人気動画"}</h2>{related.related.length ? <PublicVideoCards videos={related.related} returnTo={returnTo} /> : related.recommended?.length ? <PublicVideoCards videos={related.recommended} returnTo={returnTo} /> : <p>現在おすすめできる動画はありません。</p>}</section>
  </>;
}
