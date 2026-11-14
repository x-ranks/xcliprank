import PopularRankingPage, { popularMetadata } from "../../components/PopularRankingPage";
export const dynamic = "force-dynamic";
export const generateMetadata = () => popularMetadata("all");
export default async function PopularRankingRoute() { return PopularRankingPage({ range: "all" }); }
