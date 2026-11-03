import SiteBrand from "../components/SiteBrand";
import type { Metadata } from "next";
import { readPublicLabels } from "../../lib/public-video-server";
import { tagHref } from "../../lib/public-video-core";
import { isIndexable } from "../../lib/indexability";
export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const labels = (await readPublicLabels()).filter(label => label.count > 0);
  return { title: "タグ一覧", robots: { index: isIndexable({ type: "tag-hub", activeTags: labels.length }), follow: true, "max-image-preview": "large" },
    alternates: { canonical: "/tags" }, description: "twizouの動画タグ一覧です。",
    openGraph: { title: "タグ一覧｜twizou", url: "/tags", images: ["/twizou-share.png"] },
    twitter: { card: "summary_large_image", title: "タグ一覧｜twizou", description: "twizouの動画タグ一覧です。", images: ["/twizou-share.png"] } };
}
export default async function TagsPage() {
  const labels = (await readPublicLabels()).filter(label => label.count > 0);
  return <main style={{ maxWidth: 900, margin: "0 auto", padding: 24 }}><SiteBrand /><a href="/">新着ランキング</a>
    <h1>タグ一覧</h1><p>掲載中の動画があるタグから探せます。</p>{labels.length ? null : <p>現在表示できるタグはありません。</p>}<ul>{labels.map(label => <li key={label.id}><a href={tagHref({ ...label, active: true })}>{label.name}</a>（{label.count}件）</li>)}</ul></main>;
}
