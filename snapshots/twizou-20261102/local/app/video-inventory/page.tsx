import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { allowLabelRequest } from "../../lib/label-learning-http";
import Panel from "./Panel";
export const dynamic = "force-dynamic";
export const metadata = { title: "動画数・Tier別件数", robots: { index: false, follow: false } };
export default async function Page() {
  const h = await headers(), host = h.get("host") ?? "";
  try { if (!allowLabelRequest(new Request("http://" + host + "/video-inventory", { headers: h }))) notFound(); } catch { notFound(); }
  return <Panel />;
}
