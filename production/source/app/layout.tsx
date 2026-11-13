import type { Metadata, Viewport } from "next";
import { SITE_NAME, SITE_URL } from "../lib/seo";
import RequestAgeGate from "./components/RequestAgeGate";
import PublicDetailViewer from "./components/PublicDetailViewer";
import EngagementVisitTracker from "./components/EngagementVisitTracker";
import InstallPrompt from "./components/InstallPrompt";
import BottomTabs from "./components/BottomTabs";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  // Keep same-origin attribution; do not disclose this site URL to external media hosts.
  referrer: "same-origin",
  title: {
    default: SITE_NAME,
    template: `%s | ${SITE_NAME}`
  },
  description:
    "Xに投稿された動画を新着・24時間・週間ランキングで紹介する動画ランキングサイトです。",
  applicationName: SITE_NAME,
  appleWebApp: { capable: true, title: SITE_NAME, statusBarStyle: "black" },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "48x48" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/twizou-mark.svg", type: "image/svg+xml" }
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }]
  },
  openGraph: {
    type: "website",
    locale: "ja_JP",
    siteName: SITE_NAME,
    title: SITE_NAME,
    description:
      "Xに投稿された動画を新着・24時間・週間ランキングで紹介します。",
    url: "/",
    images: ["/twizou-share.png"]
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_NAME,
    description:
      "Xに投稿された動画を新着・24時間・週間ランキングで紹介します。",
    images: ["/twizou-share.png"]
  },
  verification: {
    google:
      process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION ||
      "pdzeUZAK3_LpeoWFtAaGGKjrWGAQMwyU9RZOjAh6VBI"
  }
};

export const viewport: Viewport = { themeColor: "#080a0d" };

export default function RootLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `try{if(localStorage.getItem("xcliprank_age_confirmed_v1")==="yes")document.documentElement.setAttribute("data-age-confirmed","yes")}catch{}` }} />
        {/* The whole site sits behind an 18+ age gate, so every page is labelled as adult content (Google's
            SafeSearch guidance asks for this). Rendered here, not via metadata `other`: Next.js did not
            inherit a layout-level `other` into pages without their own, so those pages went out unlabelled. */}
        <meta name="rating" content="adult" />
        <link rel="preconnect" href="https://pbs.twimg.com" />
        <link rel="preconnect" href="https://video.twimg.com" />
      </head>
      <body>
        {children}
        <PublicDetailViewer />
        <RequestAgeGate />
        <EngagementVisitTracker />
        <BottomTabs />
        <InstallPrompt />
      </body>
    </html>
  );
}

