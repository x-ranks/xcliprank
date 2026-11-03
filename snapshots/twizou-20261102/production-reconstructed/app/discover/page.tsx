import type { Metadata } from "next";
import SiteBrand from "../components/SiteBrand";
import SiteFooter from "../components/SiteFooter";
import DiscoveryBrowser from "../components/DiscoveryBrowser";
export const metadata: Metadata = { title: "動画を探す", robots: { index: false, follow: true } };
export default function DiscoverPage() {
  return <main><SiteBrand /><h1>動画を探す</h1><p>全期間の動画、Tier、投稿月、キーワードから探せます。</p><DiscoveryBrowser /><SiteFooter /></main>;
}
