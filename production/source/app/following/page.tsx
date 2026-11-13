import type { Metadata } from "next";
import SiteBrand from "../components/SiteBrand";
import SiteFooter from "../components/SiteFooter";
import FollowFeed from "../components/FollowFeed";
export const metadata: Metadata = { title: "フォロー中の新着", robots: { index: false, follow: false } };
export default function FollowingPage() {
  return <main><SiteBrand /><h1>フォロー中の新着</h1><FollowFeed /><SiteFooter /></main>;
}
