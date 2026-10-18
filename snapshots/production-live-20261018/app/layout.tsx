import { Analytics } from "@vercel/analytics/next";
import type { Metadata } from "next";
import { SITE_NAME, SITE_URL } from "../lib/seo";
import AgeGate from "./components/AgeGate";
import EngagementVisitTracker from "./components/EngagementVisitTracker";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_NAME,
    template: `%s | ${SITE_NAME}`
  },
  description:
    "Xに投稿された動画を新着・24時間・週間ランキングで紹介する動画ランキングサイトです。",
  applicationName: SITE_NAME,
  openGraph: {
    type: "website",
    locale: "ja_JP",
    siteName: SITE_NAME,
    title: SITE_NAME,
    description:
      "Xに投稿された動画を新着・24時間・週間ランキングで紹介します。",
    url: "/"
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_NAME,
    description:
      "Xに投稿された動画を新着・24時間・週間ランキングで紹介します。"
  },
  verification: {
    google:
      process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION ||
      "pdzeUZAK3_LpeoWFtAaGGKjrWGAQMwyU9RZOjAh6VBI"
  }
};

export default function RootLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body>
        {children}
        <AgeGate />
        <EngagementVisitTracker />
        <Analytics />
      </body>
    </html>
  );
}

