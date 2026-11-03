import { notFound } from "next/navigation";
import ManualRankingClient from "./ManualRankingClient";

export default function ManualRankingPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <ManualRankingClient />;
}
