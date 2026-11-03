import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { allowLabelRequest } from "../../lib/label-learning-http";
import LabelPublicationPanel from "./LabelPublicationPanel";
export const dynamic = "force-dynamic";
export const metadata = { title: "本番のラベル反映", robots: { index: false, follow: false } };
export default async function LabelPublicationPage() { const h = await headers(), host = h.get("host") ?? ""; try { if (!allowLabelRequest(new Request("http://" + host + "/label-publication", { headers: h }))) notFound(); } catch { notFound(); } return <LabelPublicationPanel />; }
