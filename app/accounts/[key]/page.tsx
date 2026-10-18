import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import PublicVideoCards from "../../components/PublicVideoCards";
import { PUBLIC_SITE } from "../../../lib/public-video-core";
import { readPublicAccount } from "../../../lib/public-video-server";
export const dynamic = "force-dynamic";
type Props = { params: Promise<{ key: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { key } = await params, d = await readPublicAccount(key);
  return { title: d ? `${d.name}の動画` : "投稿者が見つかりません", alternates: { canonical: `${PUBLIC_SITE}/accounts/${encodeURIComponent(key)}` }, robots: { index: false, follow: true } };
}
export default async function AccountPage({ params }: Props) {
  const { key } = await params, d = await readPublicAccount(key); if (!d) notFound();
  return <main style={{ maxWidth: 1120, margin: "0 auto", padding: 24 }}><Link href="/">新着一覧</Link><h1>{d.name}の動画</h1><PublicVideoCards videos={d.videos} /></main>;
}
