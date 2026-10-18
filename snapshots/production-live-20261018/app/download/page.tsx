import type { Metadata } from "next";
import DownloadForm from "./DownloadForm";

export const metadata: Metadata = {
  title: "X動画保存｜投稿URLから端末に保存 | Xclip",
  description: "X・Twitterの公開投稿URLから、保存を許可された動画を端末に保存できます。保存ポリシーを確認してご利用ください。",
  alternates: { canonical: "/download" },
};
export default function DownloadPage() { return <DownloadForm />; }
