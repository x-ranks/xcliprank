import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import PublicVideoCards from "../../components/PublicVideoCards";
import { PUBLIC_SITE, tagHref } from "../../../lib/public-video-core";
import { readPublicTag } from "../../../lib/public-video-server";
export const dynamic = "force-dynamic";
type Props = { params: Promise<{ name: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { name } = await params, d = await readPublicTag(name);
  return { title: d ? `${d.label.name}の動画` : "ラベルが見つかりません", ...(d ? { alternates: { canonical: PUBLIC_SITE + tagHref(d.label) } } : {}), robots: { index: false, follow: true } };
}
export default async function TagPage({ params }: Props) {
  const { name } = await params, d = await readPublicTag(name); if (!d) notFound();
  return <main style={{ maxWidth: 1120, margin: "0 auto", padding: 24 }}><Link href="/">新着一覧</Link><h1>{d.label.name}の動画</h1>{d.videos.length ? <PublicVideoCards videos={d.videos} /> : <p>現在掲載できる動画はありません。</p>}</main>;
}
