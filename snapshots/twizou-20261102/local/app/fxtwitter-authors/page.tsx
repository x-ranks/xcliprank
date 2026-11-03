import { notFound } from "next/navigation";
import FreeAuthorsPanel from "./FreeAuthorsPanel";

export const dynamic = "force-dynamic";
export const metadata = { title: "FxTwitter選別投稿者管理 | Xclip", robots: { index: false, follow: false } };
export default function FreeAuthorsPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <FreeAuthorsPanel />;
}
