import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { allowLabelRequest } from "../../lib/label-learning-http";
import LabelLearningPanel from "./LabelLearningPanel";
export const dynamic = "force-dynamic";
export const metadata = { title: "ラベル管理・4枚で学習", robots: { index: false, follow: false } };
export default async function LabelLearningPage() {
  const h = await headers(), host = h.get("host") ?? "";
  try { if (!allowLabelRequest(new Request("http://" + host + "/label-learning", { headers: h }))) notFound(); } catch { notFound(); }
  return <LabelLearningPanel />;
}
