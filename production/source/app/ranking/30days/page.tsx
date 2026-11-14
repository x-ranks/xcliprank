import PopularRankingPage, { popularMetadata } from "../../components/PopularRankingPage";
export const dynamic = "force-dynamic";
export const generateMetadata = () => popularMetadata("30days");
export default async function PopularRankingRoute() { return PopularRankingPage({ range: "30days" }); }
