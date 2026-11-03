import type { Metadata } from "next";
import SiteBrand from "../components/SiteBrand";
import SiteFooter from "../components/SiteFooter";
import DiscoveryBrowser from "../components/DiscoveryBrowser";
export const metadata: Metadata = { title: "お気に入り・保存履歴", robots: { index: false, follow: false } };
export default function FavoritesPage() {
  return <main><SiteBrand /><h1>お気に入り・保存履歴</h1><DiscoveryBrowser personalPage /><SiteFooter /></main>;
}
